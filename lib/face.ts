'use client';

import * as faceapi from '@vladmandic/face-api';
import type { SubjectType } from '@/types/database';
import { getVisiblePortraitRect, type NormalizedFaceBox } from './mediapipe';
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
      // Gunakan tinyFaceDetector (189KB) jauh lebih ringan untuk tablet RAM 3GB dibanding ssdMobilenetv1 (5.6MB)
      await Promise.all([
        faceapi.nets.tinyFaceDetector.loadFromUri('/models'),
        faceapi.nets.faceLandmark68Net.loadFromUri('/models'),
        faceapi.nets.faceRecognitionNet.loadFromUri('/models'),
      ]);

      // Warm-up ringan pada canvas kecil agar shader WebGL siap sebelum scan pertama
      const warmupCanvas = document.createElement('canvas');
      warmupCanvas.width = 128;
      warmupCanvas.height = 128;
      try {
        await faceapi.detectSingleFace(
          warmupCanvas,
          new faceapi.TinyFaceDetectorOptions({ inputSize: 128, scoreThreshold: 0.4 })
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
    const rect = getVisiblePortraitRect(video);
    const bw = faceBox.widthRatio * rect.sw;
    const bh = faceBox.heightRatio * rect.sh;
    const side = Math.max(bw, bh) * 1.65;
    const cx = rect.sx + faceBox.centerX * rect.sw;
    const cy = rect.sy + faceBox.centerY * rect.sh;

    const sx = Math.max(0, cx - side / 2);
    const sy = Math.max(0, cy - side / 2);
    const sw = Math.min(vw - sx, side);
    const sh = Math.min(vh - sy, side);

    canvas.width = 224;
    canvas.height = 224;
    const ctx = canvas.getContext('2d');
    if (ctx && sw > 20 && sh > 20) {
      ctx.drawImage(video, sx, sy, sw, sh, 0, 0, 224, 224);
      return canvas;
    }
  }

  // Fallback: downscale frame portrait ke maks 320px
  const rect = getVisiblePortraitRect(video);
  canvas.width = 240;
  canvas.height = 320;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.drawImage(video, rect.sx, rect.sy, rect.sw, rect.sh, 0, 0, 240, 320);
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
      new faceapi.TinyFaceDetectorOptions({ inputSize: 224, scoreThreshold: 0.45 })
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

  if (best.centroidDistance >= threshold + 0.045) {
    return {
      matched: false,
      reason: 'not_found',
      bestDistance: best.minDistance,
    };
  }

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
