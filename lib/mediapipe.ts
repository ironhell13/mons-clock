'use client';

import { FilesetResolver, FaceLandmarker, type FaceLandmarkerResult } from '@mediapipe/tasks-vision';
import { FACE_CONFIG } from './face-config';

let landmarkerPromise: Promise<FaceLandmarker> | null = null;
let reusableMpCanvas: HTMLCanvasElement | null = null;
let reusableQualityCanvas: HTMLCanvasElement | null = null;

const MP_W = 192;
const MP_H = 256;

export async function getFaceLandmarker(): Promise<FaceLandmarker> {
  if (!landmarkerPromise) {
    landmarkerPromise = (async () => {
      const vision = await FilesetResolver.forVisionTasks('/mediapipe/wasm');
      // Gunakan CPU SIMD WASM agar tidak berebut WebGL dengan TensorFlow / video rendering
      return await FaceLandmarker.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath: '/models/face_landmarker.task',
          delegate: 'CPU',
        },
        runningMode: 'VIDEO',
        numFaces: 2,
        outputFaceBlendshapes: false,
        outputFacialTransformationMatrixes: true, // Diperlukan untuk yaw, pitch, roll yang andal
      });
    })().catch((err) => {
      landmarkerPromise = null;
      throw err;
    });
  }
  return landmarkerPromise;
}

export interface VisiblePortraitRect {
  sx: number;
  sy: number;
  sw: number;
  sh: number;
}

export function getVisiblePortraitRect(video: HTMLVideoElement): VisiblePortraitRect {
  const vw = video.videoWidth || 720;
  const vh = video.videoHeight || 960;
  const targetAspect = 3 / 4;
  const srcAspect = vw / vh;

  if (srcAspect > targetAspect) {
    const sw = vh * targetAspect;
    const sx = (vw - sw) / 2;
    return { sx, sy: 0, sw, sh: vh };
  }
  const sh = vw / targetAspect;
  const sy = (vh - sh) / 2;
  return { sx: 0, sy, sw: vw, sh };
}

export function capturePortraitSampleCanvas(video: HTMLVideoElement): HTMLCanvasElement | null {
  if (!video.videoWidth || !video.videoHeight) return null;
  if (!reusableMpCanvas) {
    reusableMpCanvas = document.createElement('canvas');
    reusableMpCanvas.width = MP_W;
    reusableMpCanvas.height = MP_H;
  }
  const ctx = reusableMpCanvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;

  const { sx, sy, sw, sh } = getVisiblePortraitRect(video);
  ctx.drawImage(video, sx, sy, sw, sh, 0, 0, MP_W, MP_H);
  return reusableMpCanvas;
}

export interface NormalizedFaceBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  widthRatio: number;
  heightRatio: number;
  centerX: number;
  centerY: number;
  widthPx: number; // Lebar wajah aktual dalam piksel sumber video
  rollRad: number; // Sudut kemiringan kepala (radian)
  rollDeg: number; // Sudut kemiringan kepala (derajat)
  leftEye: { x: number; y: number };
  rightEye: { x: number; y: number };
}

export interface FaceQualityAnalysis {
  faceCount: number;
  statusOk: boolean;
  message: string;
  yaw: number;
  pitch: number;
  rollDeg: number;
  isBlinking: boolean;
  box: NormalizedFaceBox | null;
}

function landmarkDist(
  a: { x: number; y: number } | undefined,
  b: { x: number; y: number } | undefined
): number {
  if (!a || !b) return 0;
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/**
 * Menganalisis hasil MediaPipe FaceLandmarker dengan pose matrix & gate kualitas geometris.
 */
export function analyzeMediaPipeResult(
  result: FaceLandmarkerResult,
  video: HTMLVideoElement,
  pitchFrontal = 0,
  options?: { skipPoseGating?: boolean; maxYaw?: number; maxPitchDelta?: number }
): FaceQualityAnalysis {
  const faceCount = result.faceLandmarks?.length ?? 0;

  if (faceCount === 0) {
    return {
      faceCount: 0,
      statusOk: false,
      message: 'Posisikan wajah di dalam bingkai',
      yaw: 0,
      pitch: 0,
      rollDeg: 0,
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
      rollDeg: 0,
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

  // Koordinat mata untuk kemiringan roll 2D yang sangat stabil
  const leftEyeLandmark = landmarks[33]; // Sudut luar mata kiri
  const rightEyeLandmark = landmarks[263]; // Sudut luar mata kanan
  const dxEye = rightEyeLandmark.x - leftEyeLandmark.x;
  const dyEye = rightEyeLandmark.y - leftEyeLandmark.y;
  const rollRad = Math.atan2(dyEye, dxEye);
  const rollDeg = (rollRad * 180) / Math.PI;

  // Ekstrak yaw dan pitch dari matrix transformasi jika ada, atau hitung via geometri
  let yaw = 0;
  let pitch = 0;

  const matrix = result.facialTransformationMatrixes?.[0]?.data;
  if (matrix && matrix.length >= 16) {
    // Column-major rotation matrix
    // M[0]=R00, M[1]=R10, M[2]=R20, M[4]=R01, M[5]=R11, M[6]=R21, M[8]=R02, M[9]=R12, M[10]=R22
    yaw = Math.asin(Math.max(-1, Math.min(1, matrix[2])));
    pitch = Math.atan2(matrix[6], matrix[10]);
  } else {
    // Fallback geometri landmark
    const nose = landmarks[1];
    const leftCheek = landmarks[234];
    const rightCheek = landmarks[454];
    const forehead = landmarks[10];
    const chin = landmarks[152];

    const faceW = Math.max(0.01, Math.abs(rightCheek.x - leftCheek.x));
    const midX = (leftCheek.x + rightCheek.x) / 2;
    yaw = (nose.x - midX) / faceW;

    const faceH = Math.max(0.01, Math.abs(chin.y - forehead.y));
    const midY = (forehead.y + chin.y) / 2;
    pitch = (nose.y - midY) / faceH;
  }

  // Hitung Eye Aspect Ratio (EAR)
  const leftEyeV = landmarkDist(landmarks[159], landmarks[145]);
  const leftEyeH = Math.max(0.005, landmarkDist(landmarks[33], landmarks[133]));
  const rightEyeV = landmarkDist(landmarks[386], landmarks[374]);
  const rightEyeH = Math.max(0.005, landmarkDist(landmarks[362], landmarks[263]));
  const avgEar = (leftEyeV / leftEyeH + rightEyeV / rightEyeH) / 2;
  const isBlinking = avgEar < 0.21;

  // Hitung lebar wajah aktual dalam piksel video sumber
  const rect = getVisiblePortraitRect(video);
  const widthPx = widthRatio * rect.sw;

  const box: NormalizedFaceBox = {
    minX,
    minY,
    maxX,
    maxY,
    widthRatio,
    heightRatio,
    centerX,
    centerY,
    widthPx,
    rollRad,
    rollDeg,
    leftEye: { x: leftEyeLandmark.x, y: leftEyeLandmark.y },
    rightEye: { x: rightEyeLandmark.x, y: rightEyeLandmark.y },
  };

  // Gate 1: Jarak / Ukuran Wajah (dalam piksel sumber video)
  if (widthPx < FACE_CONFIG.MIN_FACE_PX) {
    return {
      faceCount: 1,
      statusOk: false,
      message: 'Mendekat sedikit ke kamera',
      yaw,
      pitch,
      rollDeg,
      isBlinking,
      box,
    };
  }

  if (widthRatio > 0.88 || heightRatio > 0.92) {
    return {
      faceCount: 1,
      statusOk: false,
      message: 'Mundur sedikit agar seluruh wajah terlihat',
      yaw,
      pitch,
      rollDeg,
      isBlinking,
      box,
    };
  }

  // Gate 2: Posisi Wajah di Tengah Bingkai
  if (centerX < 0.20 || centerX > 0.80 || centerY < 0.16 || centerY > 0.84) {
    return {
      faceCount: 1,
      statusOk: false,
      message: 'Posisikan wajah di tengah bingkai',
      yaw,
      pitch,
      rollDeg,
      isBlinking,
      box,
    };
  }

  // Gate 3: Sudut Hadap Wajah (Pose Gating)
  if (!options?.skipPoseGating) {
    const allowedYaw = options?.maxYaw ?? FACE_CONFIG.MAX_ABS_YAW;
    if (Math.abs(yaw) > allowedYaw) {
      return {
        faceCount: 1,
        statusOk: false,
        message: 'Hadap lurus ke kamera',
        yaw,
        pitch,
        rollDeg,
        isBlinking,
        box,
      };
    }

    const pitchDelta = pitch - pitchFrontal;
    const allowedPitch = options?.maxPitchDelta ?? FACE_CONFIG.MAX_ABS_PITCH_DELTA;
    if (Math.abs(pitchDelta) > allowedPitch) {
      return {
        faceCount: 1,
        statusOk: false,
        message: pitchDelta > 0 ? 'Tundukkan kepala sedikit' : 'Tegakkan kepala sedikit',
        yaw,
        pitch,
        rollDeg,
        isBlinking,
        box,
      };
    }
  }

  if (Math.abs(rollDeg) > FACE_CONFIG.MAX_ABS_ROLL_DEG) {
    return {
      faceCount: 1,
      statusOk: false,
      message: 'Posisikan kepala tegak lurus',
      yaw,
      pitch,
      rollDeg,
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
    rollDeg,
    isBlinking,
    box,
  };
}

export interface CropQualityMetrics {
  brightness: number;
  lrRatio: number;
  clippedPct: number;
  sharpness: number;
}

/**
 * Fungsi Murni Evaluasi Metrik Kualitas Gambar Wajah
 * Menguji luminance, rasio kiri/kanan, pixel jenuh (silau), dan ketajaman (Laplacian).
 */
export function evaluateCropPixels(
  data: Uint8ClampedArray | Uint8Array | number[],
  sampleW: number = 160,
  sampleH: number = 160
): {
  ok: boolean;
  reason?: string;
  metrics: CropQualityMetrics;
} {
  const totalPixels = sampleW * sampleH;
  const gray = new Float32Array(totalPixels);

  let sumBrightness = 0;
  let leftBrightness = 0;
  let rightBrightness = 0;
  let clippedCount = 0;

  const midX = sampleW / 2;

  for (let y = 0; y < sampleH; y++) {
    for (let x = 0; x < sampleW; x++) {
      const idx = (y * sampleW + x) * 4;
      const r = data[idx];
      const g = data[idx + 1];
      const b = data[idx + 2];

      // Luminance ITU-R BT.601
      const lum = 0.299 * r + 0.587 * g + 0.114 * b;
      const pIdx = y * sampleW + x;
      gray[pIdx] = lum;
      sumBrightness += lum;

      if (lum > 250) clippedCount++;

      if (x < midX) {
        leftBrightness += lum;
      } else {
        rightBrightness += lum;
      }
    }
  }

  const brightness = sumBrightness / totalPixels;
  const halfPixels = totalPixels / 2;
  const leftAvg = leftBrightness / halfPixels;
  const rightAvg = rightBrightness / halfPixels;
  const lrRatio = leftAvg / Math.max(1, rightAvg);
  const clippedPct = (clippedCount / totalPixels) * 100;

  // Hitung Ketajaman (Variance of Laplacian)
  // Kernel: [0, 1, 0; 1, -4, 1; 0, 1, 0]
  let lapSum = 0;
  let lapSumSq = 0;
  let lapCount = 0;

  for (let y = 1; y < sampleH - 1; y++) {
    for (let x = 1; x < sampleW - 1; x++) {
      const idx = y * sampleW + x;
      const val =
        gray[idx - sampleW] +
        gray[idx + sampleW] +
        gray[idx - 1] +
        gray[idx + 1] -
        4 * gray[idx];

      lapSum += val;
      lapSumSq += val * val;
      lapCount++;
    }
  }

  const lapMean = lapSum / lapCount;
  const sharpness = Math.max(0, lapSumSq / lapCount - lapMean * lapMean);

  const metrics: CropQualityMetrics = {
    brightness: Math.round(brightness),
    lrRatio: Number(lrRatio.toFixed(2)),
    clippedPct: Number(clippedPct.toFixed(1)),
    sharpness: Math.round(sharpness),
  };

  // Validasi Kualitas terhadap Konfigurasi
  const [minB, maxB] = FACE_CONFIG.BRIGHTNESS_RANGE;
  if (brightness < minB) {
    return { ok: false, reason: 'Pencahayaan terlalu gelap, cari area lebih terang', metrics };
  }
  if (brightness > maxB) {
    return { ok: false, reason: 'Pencahayaan terlalu silau / over-exposure', metrics };
  }

  const [minLR, maxLR] = FACE_CONFIG.LR_BRIGHTNESS_RATIO;
  if (lrRatio < minLR || lrRatio > maxLR) {
    return { ok: false, reason: 'Cahaya tidak merata (hindari bayangan atau cahaya dari samping)', metrics };
  }

  if (clippedPct > FACE_CONFIG.MAX_CLIPPED_PIXEL_PCT) {
    return { ok: false, reason: 'Wajah terlalu silau', metrics };
  }

  if (sharpness < FACE_CONFIG.MIN_SHARPNESS) {
    return { ok: false, reason: 'Gambar buram, tahan posisi tetap tenang', metrics };
  }

  return { ok: true, metrics };
}

/**
 * Filter Kualitas Gambar Pada Crop Wajah (160x160 Grayscale)
 * Memeriksa luminance, backlight/bayangan samping, over-exposure, dan ketajaman (Laplacian).
 */
export function checkCropQuality(cropCanvas: HTMLCanvasElement): {
  ok: boolean;
  reason?: string;
  metrics: CropQualityMetrics;
} {
  const sampleW = 160;
  const sampleH = 160;

  if (!reusableQualityCanvas) {
    reusableQualityCanvas = document.createElement('canvas');
    reusableQualityCanvas.width = sampleW;
    reusableQualityCanvas.height = sampleH;
  }

  const qCtx = reusableQualityCanvas.getContext('2d', { willReadFrequently: true });
  if (!qCtx) {
    return {
      ok: true,
      metrics: { brightness: 120, lrRatio: 1, clippedPct: 0, sharpness: 100 },
    };
  }

  // Draw crop ke 160x160
  qCtx.drawImage(cropCanvas, 0, 0, sampleW, sampleH);
  const imgData = qCtx.getImageData(0, 0, sampleW, sampleH);
  return evaluateCropPixels(imgData.data, sampleW, sampleH);
}
