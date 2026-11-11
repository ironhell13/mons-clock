'use client';

import * as faceapi from '@vladmandic/face-api';
import type { SubjectType } from '@/types/database';
import type { NormalizedFaceBox } from './mediapipe';
import {
  getCachedFaceTemplates,
  invalidateFaceTemplatesCache,
  type CachedFaceTemplate,
} from './face-cache';

export {
  getCachedFaceTemplates,
  invalidateFaceTemplatesCache,
  type CachedFaceTemplate,
};

export interface FaceMatchSuccess {
  matched: true;
  subject_type: SubjectType;
  subject_id: string;
  name: string;
  subtitle: string;
  distance: number;
}

export interface FaceMatchFailure {
  matched: false;
  reason: 'not_found' | 'ambiguous' | 'empty_database';
  bestDistance?: number;
}

export type FaceMatchOutcome = FaceMatchSuccess | FaceMatchFailure;

const RAW_ENV_THRESHOLD = Number(process.env.NEXT_PUBLIC_FACE_THRESHOLD || '0.42');
// Batasi threshold efektif maks 0.42 agar dua orang berbeda tidak saling tertukar
const STRICT_MAX_THRESHOLD = 0.42;
const MARGIN_THRESHOLD = 0.06;

let modelsReadyPromise: Promise<void> | null = null;
let reusableCropCanvas: HTMLCanvasElement | null = null;

export function getFaceThreshold(): number {
  const base = Number.isFinite(RAW_ENV_THRESHOLD) && RAW_ENV_THRESHOLD > 0
    ? RAW_ENV_THRESHOLD
    : STRICT_MAX_THRESHOLD;
  return Math.min(base, STRICT_MAX_THRESHOLD);
}

export async function ensureFaceModelsLoaded(): Promise<void> {
  if (!modelsReadyPromise) {
    modelsReadyPromise = (async () => {
      await Promise.all([
        faceapi.nets.ssdMobilenetv1.loadFromUri('/models'),
        faceapi.nets.faceLandmark68Net.loadFromUri('/models'),
        faceapi.nets.faceRecognitionNet.loadFromUri('/models'),
      ]);

      // Warm-up ringan pada canvas kecil agar inferensi pertama cepat
      const warmupCanvas = document.createElement('canvas');
      warmupCanvas.width = 160;
      warmupCanvas.height = 160;
      try {
        await faceapi.detectSingleFace(
          warmupCanvas,
          new faceapi.SsdMobilenetv1Options({ minConfidence: 0.5 })
        );
      } catch {
        // abaikan error warm-up
      }
    })().catch((err) => {
      modelsReadyPromise = null;
      throw err;
    });
  }
  return modelsReadyPromise;
}

function getTargetCanvas(
  video: HTMLVideoElement,
  faceBox?: NormalizedFaceBox | null
): HTMLCanvasElement {
  if (!reusableCropCanvas) {
    reusableCropCanvas = document.createElement('canvas');
  }
  const canvas = reusableCropCanvas;
  const vw = video.videoWidth;
  const vh = video.videoHeight;

  if (faceBox && vw > 0 && vh > 0) {
    // Crop area wajah + padding 55% ke canvas 320x320 untuk percepat deteksi 4-6x di tablet
    const bw = faceBox.widthRatio * vw;
    const bh = faceBox.heightRatio * vh;
    const side = Math.max(bw, bh) * 1.65;
    const cx = faceBox.centerX * vw;
    const cy = faceBox.centerY * vh;

    const sx = Math.max(0, cx - side / 2);
    const sy = Math.max(0, cy - side / 2);
    const sw = Math.min(vw - sx, side);
    const sh = Math.min(vh - sy, side);

    canvas.width = 320;
    canvas.height = 320;
    const ctx = canvas.getContext('2d');
    if (ctx && sw > 20 && sh > 20) {
      ctx.drawImage(video, sx, sy, sw, sh, 0, 0, 320, 320);
      return canvas;
    }
  }

  // Fallback: downscale frame proporsional dengan sisi maks 480px
  const scale = Math.min(1, 480 / Math.max(vw, vh, 1));
  canvas.width = Math.max(160, Math.round(vw * scale));
  canvas.height = Math.max(160, Math.round(vh * scale));
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  }
  return canvas;
}

export async function extractFaceDescriptor(
  video: HTMLVideoElement,
  faceBox?: NormalizedFaceBox | null
): Promise<number[] | null> {
  await ensureFaceModelsLoaded();

  const inputCanvas = getTargetCanvas(video, faceBox);

  const detection = await faceapi
    .detectSingleFace(
      inputCanvas,
      new faceapi.SsdMobilenetv1Options({ minConfidence: 0.55 })
    )
    .withFaceLandmarks()
    .withFaceDescriptor();

  if (!detection || !detection.descriptor) {
    return null;
  }

  return Array.from(detection.descriptor);
}

export function euclideanDistance(a: number[], b: number[]): number {
  if (a.length !== b.length) return Number.POSITIVE_INFINITY;
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    const d = a[i] - b[i];
    sum += d * d;
  }
  return Math.sqrt(sum);
}

function computeCentroid(vectors: number[][]): number[] {
  if (vectors.length === 0) return [];
  const dim = vectors[0].length;
  const mean = new Array<number>(dim).fill(0);
  for (const vec of vectors) {
    for (let i = 0; i < dim; i++) {
      mean[i] += vec[i];
    }
  }
  for (let i = 0; i < dim; i++) {
    mean[i] /= vectors.length;
  }
  return mean;
}

export function matchDescriptor(
  query: number[],
  templates: CachedFaceTemplate[],
  threshold = getFaceThreshold()
): FaceMatchOutcome {
  if (templates.length === 0) {
    return { matched: false, reason: 'empty_database' };
  }

  const grouped = new Map<
    string,
    {
      subject_id: string;
      subject_type: SubjectType;
      name: string;
      subtitle: string;
      minDistance: number;
      descriptors: number[][];
    }
  >();

  for (const tpl of templates) {
    const dist = euclideanDistance(query, tpl.descriptor);
    const prev = grouped.get(tpl.subject_id);
    if (!prev) {
      grouped.set(tpl.subject_id, {
        subject_id: tpl.subject_id,
        subject_type: tpl.subject_type,
        name: tpl.name,
        subtitle: tpl.subtitle,
        minDistance: dist,
        descriptors: [tpl.descriptor],
      });
    } else {
      if (dist < prev.minDistance) prev.minDistance = dist;
      prev.descriptors.push(tpl.descriptor);
    }
  }

  const ranked = Array.from(grouped.values())
    .map((person) => {
      const centroid = computeCentroid(person.descriptors);
      const centroidDist = euclideanDistance(query, centroid);
      return {
        ...person,
        centroidDistance: centroidDist,
        // Kombinasi jarak minimum + centroid untuk menghindari outlier salah orang
        score: person.minDistance * 0.7 + centroidDist * 0.3,
      };
    })
    .sort((a, b) => a.minDistance - b.minDistance);

  const best = ranked[0];
  const secondBest = ranked[1];

  if (!best || best.minDistance >= threshold) {
    return {
      matched: false,
      reason: 'not_found',
      bestDistance: best?.minDistance,
    };
  }

  // Pastikan jarak ke rata-rata template orang tersebut juga konsisten dekat
  if (best.centroidDistance >= threshold + 0.045) {
    return {
      matched: false,
      reason: 'not_found',
      bestDistance: best.minDistance,
    };
  }

  // Cek margin ke kandidat terbaik kedua agar dua orang mirip tidak saling tertukar
  if (
    secondBest &&
    best.minDistance > 0.28 &&
    secondBest.minDistance - best.minDistance < MARGIN_THRESHOLD
  ) {
    return {
      matched: false,
      reason: 'ambiguous',
      bestDistance: best.minDistance,
    };
  }

  return {
    matched: true,
    subject_type: best.subject_type,
    subject_id: best.subject_id,
    name: best.name,
    subtitle: best.subtitle,
    distance: best.minDistance,
  };
}
