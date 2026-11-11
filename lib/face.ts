'use client';

import * as faceapi from '@vladmandic/face-api';
import type { SubjectType } from '@/types/database';
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

const DEFAULT_THRESHOLD = Number(process.env.NEXT_PUBLIC_FACE_THRESHOLD || '0.5');
const MARGIN_THRESHOLD = 0.04;

let modelsReadyPromise: Promise<void> | null = null;

export function getFaceThreshold(): number {
  return Number.isFinite(DEFAULT_THRESHOLD) && DEFAULT_THRESHOLD > 0
    ? DEFAULT_THRESHOLD
    : 0.5;
}

export async function ensureFaceModelsLoaded(): Promise<void> {
  if (!modelsReadyPromise) {
    modelsReadyPromise = (async () => {
      await Promise.all([
        faceapi.nets.ssdMobilenetv1.loadFromUri('/models'),
        faceapi.nets.faceLandmark68Net.loadFromUri('/models'),
        faceapi.nets.faceRecognitionNet.loadFromUri('/models'),
      ]);

      // Warm-up ringan agar inferensi pertama tidak lag
      const warmupCanvas = document.createElement('canvas');
      warmupCanvas.width = 128;
      warmupCanvas.height = 128;
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

export async function extractFaceDescriptor(
  video: HTMLVideoElement
): Promise<number[] | null> {
  await ensureFaceModelsLoaded();

  const detection = await faceapi
    .detectSingleFace(
      video,
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

export function matchDescriptor(
  query: number[],
  templates: CachedFaceTemplate[],
  threshold = getFaceThreshold()
): FaceMatchOutcome {
  if (templates.length === 0) {
    return { matched: false, reason: 'empty_database' };
  }

  const perPersonBest = new Map<
    string,
    {
      subject_id: string;
      subject_type: SubjectType;
      name: string;
      subtitle: string;
      distance: number;
    }
  >();

  for (const tpl of templates) {
    const dist = euclideanDistance(query, tpl.descriptor);
    const prev = perPersonBest.get(tpl.subject_id);
    if (!prev || dist < prev.distance) {
      perPersonBest.set(tpl.subject_id, {
        subject_id: tpl.subject_id,
        subject_type: tpl.subject_type,
        name: tpl.name,
        subtitle: tpl.subtitle,
        distance: dist,
      });
    }
  }

  const ranked = Array.from(perPersonBest.values()).sort((a, b) => a.distance - b.distance);
  const best = ranked[0];
  const secondBest = ranked[1];

  if (!best || best.distance >= threshold) {
    return {
      matched: false,
      reason: 'not_found',
      bestDistance: best?.distance,
    };
  }

  if (
    secondBest &&
    secondBest.distance - best.distance < MARGIN_THRESHOLD &&
    best.distance > threshold * 0.72
  ) {
    return {
      matched: false,
      reason: 'ambiguous',
      bestDistance: best.distance,
    };
  }

  return {
    matched: true,
    subject_type: best.subject_type,
    subject_id: best.subject_id,
    name: best.name,
    subtitle: best.subtitle,
    distance: best.distance,
  };
}
