'use client';

import * as faceapi from '@vladmandic/face-api';
import {
  getVisiblePortraitRect,
  checkCropQuality,
  type NormalizedFaceBox,
  type CropQualityMetrics,
} from './mediapipe';

export const CROP_SIZE = 320;
export const CROP_EXPAND_FACTOR = 1.4;

/**
 * Antarmuka Modular FaceEmbedder (Persiapan Fase 8)
 * Memungkinkan pergantian engine ekstraksi fitur wajah (face-api dlib ResNet vs MobileFaceNet / ArcFace ONNX)
 * tanpa mengubah struktur pipeline aplikasi.
 */
export interface FaceEmbedder {
  readonly dim: number;
  readonly name: string;
  extract(canvas: HTMLCanvasElement): Promise<number[] | null>;
}

let modelsReadyPromise: Promise<void> | null = null;
let reusableCropCanvas: HTMLCanvasElement | null = null;

export async function ensureFaceModelsLoaded(): Promise<void> {
  if (!modelsReadyPromise) {
    modelsReadyPromise = (async () => {
      // Gunakan tinyFaceDetector (189KB) + landmark 68 + faceRecognition
      await Promise.all([
        faceapi.nets.tinyFaceDetector.loadFromUri('/models'),
        faceapi.nets.faceLandmark68Net.loadFromUri('/models'),
        faceapi.nets.faceRecognitionNet.loadFromUri('/models'),
      ]);

      // Warm-up canvas kecil agar shader WebGL siap sebelum scan pertama
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

/**
 * Memotong wajah 1.4x bounding box dari video resolusi penuh dengan koreksi roll (mata horizontal).
 */
export function getRollCorrectedCrop(
  video: HTMLVideoElement,
  faceBox: NormalizedFaceBox
): HTMLCanvasElement {
  if (!reusableCropCanvas) {
    reusableCropCanvas = document.createElement('canvas');
    reusableCropCanvas.width = CROP_SIZE;
    reusableCropCanvas.height = CROP_SIZE;
  }
  const canvas = reusableCropCanvas;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return canvas;

  const rect = getVisiblePortraitRect(video);
  const bw = faceBox.widthRatio * rect.sw;
  const bh = faceBox.heightRatio * rect.sh;
  const side = Math.max(bw, bh) * CROP_EXPAND_FACTOR;

  const cx = rect.sx + faceBox.centerX * rect.sw;
  const cy = rect.sy + faceBox.centerY * rect.sh;

  const halfSize = CROP_SIZE / 2;

  // Bersihkan canvas dan terapkan rotasi koreksi roll
  ctx.save();
  ctx.clearRect(0, 0, CROP_SIZE, CROP_SIZE);
  ctx.translate(halfSize, halfSize);
  ctx.rotate(-faceBox.rollRad);

  // Gambar bagian wajah dari frame video resolusi penuh ke tengah canvas
  ctx.drawImage(
    video,
    cx - side / 2,
    cy - side / 2,
    side,
    side,
    -halfSize,
    -halfSize,
    CROP_SIZE,
    CROP_SIZE
  );

  ctx.restore();
  return canvas;
}

export interface ExtractDescriptorResult {
  descriptor: number[] | null;
  cropCanvas?: HTMLCanvasElement;
  reason?: string;
  metrics?: CropQualityMetrics;
}

/**
 * Ekstraksi Vektor Wajah 128-dimensi dengan Roll Correction & Sanity Check Konsistensi Bounding Box.
 */
export async function extractFaceDescriptor(
  video: HTMLVideoElement,
  faceBox: NormalizedFaceBox
): Promise<ExtractDescriptorResult> {
  await ensureFaceModelsLoaded();

  if (!faceBox || faceBox.widthPx <= 0) {
    return { descriptor: null, reason: 'Wajah tidak terdeteksi' };
  }

  // 1. Dapatkan crop 320x320 dengan koreksi roll
  const cropCanvas = getRollCorrectedCrop(video, faceBox);

  // 2. Evaluasi Kualitas Gambar pada Crop (Luminance, L/R Backlight, Silau, Ketajaman)
  const quality = checkCropQuality(cropCanvas);
  if (!quality.ok) {
    return {
      descriptor: null,
      cropCanvas,
      reason: quality.reason,
      metrics: quality.metrics,
    };
  }

  // 3. Deteksi Wajah dengan TinyFaceDetector pada crop 320x320
  const detection = await faceapi
    .detectSingleFace(
      cropCanvas,
      new faceapi.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: 0.5 })
    )
    .withFaceLandmarks()
    .withFaceDescriptor();

  if (!detection || !detection.descriptor) {
    return {
      descriptor: null,
      cropCanvas,
      reason: 'Wajah kurang jelas pada crop, tahan stabil',
      metrics: quality.metrics,
    };
  }

  // 4. Sanity Check: Pastikan hasil TinyFaceDetector konsisten dengan pusat crop (MediaPipe)
  const detBox = detection.detection.box;
  const detCenterX = detBox.x + detBox.width / 2;
  const detCenterY = detBox.y + detBox.height / 2;
  const centerShift = Math.hypot(detCenterX - CROP_SIZE / 2, detCenterY - CROP_SIZE / 2);

  // Pusat TinyFaceDetector tidak boleh bergeser lebih dari 12% dari sisi crop (38.4 px)
  if (centerShift > CROP_SIZE * 0.12) {
    return {
      descriptor: null,
      cropCanvas,
      reason: 'Posisi wajah bergeser, pertahankan posisi stabil',
      metrics: quality.metrics,
    };
  }

  // Ukuran kotak TinyFaceDetector harus wajar (rasio 35% s/d 90% dari 320px)
  const sizeRatio = Math.max(detBox.width, detBox.height) / CROP_SIZE;
  if (sizeRatio < 0.35 || sizeRatio > 0.90) {
    return {
      descriptor: null,
      cropCanvas,
      reason: 'Ukuran wajah pada crop di luar batas toleransi',
      metrics: quality.metrics,
    };
  }

  return {
    descriptor: Array.from(detection.descriptor),
    cropCanvas,
    metrics: quality.metrics,
  };
}

/**
 * Memainkan nada beep sintetis lembut sebagai umpan balik saat flash capture berhasil
 */
export function playBeep(freq = 880, durationMs = 90): void {
  if (typeof window === 'undefined') return;
  try {
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, ctx.currentTime);
    gain.gain.setValueAtTime(0.08, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + durationMs / 1000);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + durationMs / 1000);
  } catch {
    // Abaikan jika audio terblokir oleh browser autoplay policy
  }
}

