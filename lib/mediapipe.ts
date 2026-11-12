'use client';

import { FilesetResolver, FaceLandmarker, type FaceLandmarkerResult } from '@mediapipe/tasks-vision';

let landmarkerPromise: Promise<FaceLandmarker> | null = null;
let reusableMpCanvas: HTMLCanvasElement | null = null;
let reusableQualityBuf: Float32Array | null = null;

const MP_W = 192;
const MP_H = 256;

export async function getFaceLandmarker(): Promise<FaceLandmarker> {
  if (!landmarkerPromise) {
    landmarkerPromise = (async () => {
      const vision = await FilesetResolver.forVisionTasks('/mediapipe/wasm');
      // Gunakan CPU SIMD WASM agar tidak berebut WebGL dengan video compositing & face-api pada GPU tablet (Mali/Adreno entry-level)
      return await FaceLandmarker.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath: '/models/face_landmarker.task',
          delegate: 'CPU',
        },
        runningMode: 'VIDEO',
        numFaces: 2,
        outputFaceBlendshapes: false,
        outputFacialTransformationMatrixes: false,
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
  const vw = video.videoWidth || 480;
  const vh = video.videoHeight || 640;
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
}

export interface FaceQualityAnalysis {
  faceCount: number;
  statusOk: boolean;
  message: string;
  yaw: number;
  pitch: number;
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

  // Hitung Eye Aspect Ratio langsung dari landmark mata (tanpa beban model blendshapes)
  const leftEyeV = landmarkDist(landmarks[159], landmarks[145]);
  const leftEyeH = Math.max(0.005, landmarkDist(landmarks[33], landmarks[133]));
  const rightEyeV = landmarkDist(landmarks[386], landmarks[374]);
  const rightEyeH = Math.max(0.005, landmarkDist(landmarks[362], landmarks[263]));
  const avgEar = (leftEyeV / leftEyeH + rightEyeV / rightEyeH) / 2;
  const isBlinking = avgEar < 0.21;

  const box: NormalizedFaceBox = {
    minX,
    minY,
    maxX,
    maxY,
    widthRatio,
    heightRatio,
    centerX,
    centerY,
  };

  if (widthRatio < 0.16 || heightRatio < 0.17) {
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

  if (widthRatio > 0.88 || heightRatio > 0.92) {
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

  if (centerX < 0.20 || centerX > 0.80 || centerY < 0.16 || centerY > 0.84) {
    return {
      faceCount: 1,
      statusOk: false,
      message: 'Posisikan wajah di tengah bingkai',
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

export function checkCanvasQuality(canvas: HTMLCanvasElement): {
  ok: boolean;
  reason?: string;
} {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return { ok: true };

  // Sampling grid 96x128 dari tengah canvas (zero canvas allocation)
  const w = 96;
  const h = 128;
  const ox = Math.max(0, Math.floor((canvas.width - w) / 2));
  const oy = Math.max(0, Math.floor((canvas.height - h) / 2));
  const img = ctx.getImageData(ox, oy, w, h).data;

  if (!reusableQualityBuf || reusableQualityBuf.length !== w * h) {
    reusableQualityBuf = new Float32Array(w * h);
  }
  const lumGrid = reusableQualityBuf;

  let sumLum = 0;
  let edgeEnergy = 0;

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

  if (avgBrightness < 34) {
    return { ok: false, reason: 'Pencahayaan terlalu gelap, tambah cahaya' };
  }
  if (avgEdge < 4.5) {
    return { ok: false, reason: 'Gambar buram, tahan posisi stabil' };
  }
  return { ok: true };
}
