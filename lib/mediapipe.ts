'use client';

import { FilesetResolver, FaceLandmarker, type FaceLandmarkerResult } from '@mediapipe/tasks-vision';

let landmarkerPromise: Promise<FaceLandmarker> | null = null;

export async function getFaceLandmarker(): Promise<FaceLandmarker> {
  if (!landmarkerPromise) {
    landmarkerPromise = (async () => {
      const vision = await FilesetResolver.forVisionTasks('/mediapipe/wasm');
      try {
        return await FaceLandmarker.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath: '/models/face_landmarker.task',
            delegate: 'GPU',
          },
          runningMode: 'VIDEO',
          numFaces: 2,
          outputFaceBlendshapes: true,
          outputFacialTransformationMatrixes: false,
        });
      } catch {
        // Fallback ke CPU pada perangkat yang tidak mendukung WebGL GPU delegate
        return await FaceLandmarker.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath: '/models/face_landmarker.task',
            delegate: 'CPU',
          },
          runningMode: 'VIDEO',
          numFaces: 2,
          outputFaceBlendshapes: true,
          outputFacialTransformationMatrixes: false,
        });
      }
    })().catch((err) => {
      landmarkerPromise = null;
      throw err;
    });
  }
  return landmarkerPromise;
}

export interface FaceQualityAnalysis {
  faceCount: number;
  statusOk: boolean;
  message: string;
  yaw: number; // positif = menoleh ke kiri layar (cermin), negatif = ke kanan
  pitch: number; // negatif = menengadah, positif = menunduk
  isBlinking: boolean;
  box: {
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
    widthRatio: number;
    heightRatio: number;
    centerX: number;
    centerY: number;
  } | null;
}

export function analyzeMediaPipeResult(result: FaceLandmarkerResult): FaceQualityAnalysis {
  const faceCount = result.faceLandmarks?.length ?? 0;

  if (faceCount === 0) {
    return {
      faceCount: 0,
      statusOk: false,
      message: 'Posisikan wajah di dalam bingkai',
      yaw: 0,
      pitch: 0,
      isBlinking: false,
      box: null,
    };
  }

  if (faceCount > 1) {
    return {
      faceCount,
      statusOk: false,
      message: 'Pastikan hanya satu wajah di depan kamera',
      yaw: 0,
      pitch: 0,
      isBlinking: false,
      box: null,
    };
  }

  const landmarks = result.faceLandmarks[0];
  let minX = 1;
  let minY = 1;
  let maxX = 0;
  let maxY = 0;

  for (const pt of landmarks) {
    if (pt.x < minX) minX = pt.x;
    if (pt.y < minY) minY = pt.y;
    if (pt.x > maxX) maxX = pt.x;
    if (pt.y > maxY) maxY = pt.y;
  }

  const widthRatio = maxX - minX;
  const heightRatio = maxY - minY;
  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;

  // Hitung estimasi yaw & pitch dari landmark hidung (1), pipi (234, 454), dahi (10), dagu (152)
  const nose = landmarks[1];
  const leftCheek = landmarks[234];
  const rightCheek = landmarks[454];
  const forehead = landmarks[10];
  const chin = landmarks[152];

  const faceW = Math.max(0.01, Math.abs(rightCheek.x - leftCheek.x));
  const midX = (leftCheek.x + rightCheek.x) / 2;
  const yaw = (nose.x - midX) / faceW;

  const faceH = Math.max(0.01, Math.abs(chin.y - forehead.y));
  const midY = (forehead.y + chin.y) / 2;
  const pitch = (nose.y - midY) / faceH;

  const blendshapes = result.faceBlendshapes?.[0]?.categories ?? [];
  const blinkLeft = blendshapes.find((c) => c.categoryName === 'eyeBlinkLeft')?.score ?? 0;
  const blinkRight = blendshapes.find((c) => c.categoryName === 'eyeBlinkRight')?.score ?? 0;
  const isBlinking = blinkLeft > 0.36 || blinkRight > 0.36;

  const box = { minX, minY, maxX, maxY, widthRatio, heightRatio, centerX, centerY };

  if (widthRatio < 0.16 || heightRatio < 0.20) {
    return {
      faceCount: 1,
      statusOk: false,
      message: 'Mendekat sedikit ke kamera',
      yaw,
      pitch,
      isBlinking,
      box,
    };
  }

  if (widthRatio > 0.78 || heightRatio > 0.88) {
    return {
      faceCount: 1,
      statusOk: false,
      message: 'Mundur sedikit agar seluruh wajah terlihat',
      yaw,
      pitch,
      isBlinking,
      box,
    };
  }

  if (centerX < 0.26 || centerX > 0.74 || centerY < 0.22 || centerY > 0.78) {
    return {
      faceCount: 1,
      statusOk: false,
      message: 'Posisikan wajah di tengah bingkai oval',
      yaw,
      pitch,
      isBlinking,
      box,
    };
  }

  return {
    faceCount: 1,
    statusOk: true,
    message: 'Wajah terdeteksi baik',
    yaw,
    pitch,
    isBlinking,
    box,
  };
}

export function checkVideoFrameQuality(video: HTMLVideoElement): {
  ok: boolean;
  reason?: string;
} {
  if (!video.videoWidth || !video.videoHeight) {
    return { ok: false, reason: 'Kamera belum siap' };
  }

  const w = 160;
  const h = 120;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return { ok: true };

  ctx.drawImage(video, 0, 0, w, h);
  const img = ctx.getImageData(0, 0, w, h).data;

  let sumLum = 0;
  let edgeEnergy = 0;
  const lumGrid = new Float32Array(w * h);

  for (let i = 0; i < w * h; i++) {
    const idx = i * 4;
    const lum = 0.299 * img[idx] + 0.587 * img[idx + 1] + 0.114 * img[idx + 2];
    lumGrid[i] = lum;
    sumLum += lum;
  }

  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const idx = y * w + x;
      const gx = Math.abs(lumGrid[idx + 1] - lumGrid[idx - 1]);
      const gy = Math.abs(lumGrid[idx + w] - lumGrid[idx - w]);
      edgeEnergy += gx + gy;
    }
  }

  const avgBrightness = sumLum / (w * h);
  const avgEdge = edgeEnergy / ((w - 2) * (h - 2));

  if (avgBrightness < 36) {
    return { ok: false, reason: 'Pencahayaan terlalu gelap, tambah cahaya' };
  }
  if (avgEdge < 5.5) {
    return { ok: false, reason: 'Gambar buram, tahan posisi stabil' };
  }
  return { ok: true };
}

