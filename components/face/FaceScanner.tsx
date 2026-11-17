'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import {
  AlertCircle,
  Loader2,
  RefreshCw,
  ScanFace,
  X,
} from 'lucide-react';
import type { SubjectType, VerificationPurpose } from '@/types/database';
import { ensureFaceModelsLoaded, extractFaceDescriptor, playBeep } from '@/lib/face';
import {
  analyzeMediaPipeResult,
  capturePortraitSampleCanvas,
  getFaceLandmarker,
  type CropQualityMetrics,
  type NormalizedFaceBox,
} from '@/lib/mediapipe';
import { ConfirmIdentitySheet, type ConfirmCandidate } from './ConfirmIdentitySheet';

export interface FaceScanSuccessPayload {
  verification_id: string;
  subject_type: SubjectType;
  subject_id: string;
  name: string;
  subtitle: string;
  code?: string;
}

export interface FaceScannerProps {
  purpose?: VerificationPurpose | SubjectType;
  title?: string;
  subtitle?: string;
  onResult: (result: FaceScanSuccessPayload) => void | Promise<void>;
  onCancel: () => void;
  paused?: boolean;
  showEnrollHintLink?: boolean;
}

export function FaceScanner({
  purpose = 'absen',
  title,
  subtitle,
  onResult,
  onCancel,
  paused = false,
  showEnrollHintLink = true,
}: FaceScannerProps) {
  // Normalisasi purpose dan subject_type
  const normalizedPurpose: VerificationPurpose =
    purpose === 'escort'
      ? 'trip_escort'
      : purpose === 'employee'
      ? 'absen'
      : (purpose as VerificationPurpose);

  const subjectType: SubjectType =
    normalizedPurpose === 'trip_escort' ? 'escort' : 'employee';

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const processingRef = useRef<boolean>(false);
  const cooldownUntilRef = useRef<number>(0);
  const stableStartTimeRef = useRef<number | null>(null);
  const lastBoxRef = useRef<NormalizedFaceBox | null>(null);
  const pitchFrontalRef = useRef<number>(0);

  const [cameraReady, setCameraReady] = useState(false);
  const [modelsReady, setModelsReady] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState('Menyalakan kamera...');
  const [statusTone, setStatusTone] = useState<'neutral' | 'ready' | 'success' | 'warn' | 'error'>('neutral');
  const [failCount, setFailCount] = useState(0);
  const [retryCounter, setRetryCounter] = useState(0);

  // State Konfirmasi (Zona Confirm)
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmVerificationId, setConfirmVerificationId] = useState<string>('');
  const [confirmCandidates, setConfirmCandidates] = useState<ConfirmCandidate[]>([]);

  // Debug metrics overlay
  const [showDebug, setShowDebug] = useState(false);
  const [debugMetrics, setDebugMetrics] = useState<{
    widthPx?: number;
    yaw?: number;
    pitch?: number;
    rollDeg?: number;
    cropMetrics?: CropQualityMetrics;
    lastScore?: number | null;
    lastMargin?: number | null;
  }>({});

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const sp = new URLSearchParams(window.location.search);
      if (sp.get('debug') === '1') setShowDebug(true);
    }
  }, []);

  const stopCamera = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  }, []);

  const resetCaptureState = useCallback(() => {
    stableStartTimeRef.current = null;
  }, []);

  // Eksekusi Pemindaian Wajah Alami (Instant Face Capture & Match)
  const performFaceCapture = useCallback(
    async (box: NormalizedFaceBox) => {
      const video = videoRef.current;
      if (!video || processingRef.current) return;

      processingRef.current = true;
      setStatusTone('ready');
      setStatusMessage('Memindai wajah...');

      let descriptor: number[] | null = null;
      let metrics: CropQualityMetrics | undefined;
      try {
        const extractRes = await extractFaceDescriptor(video, box);
        descriptor = extractRes.descriptor;
        metrics = extractRes.metrics;
      } catch {
        descriptor = null;
      }

      if (showDebug && metrics) {
        setDebugMetrics((prev) => ({ ...prev, cropMetrics: metrics }));
      }

      if (!descriptor) {
        processingRef.current = false;
        resetCaptureState();
        setStatusTone('warn');
        setStatusMessage('Posisikan wajah lebih jelas & tidak bergerak');
        cooldownUntilRef.current = Date.now() + 500;
        return;
      }

      // Mainkan suara tangkap
      playBeep(880, 80);

      setStatusTone('ready');
      setStatusMessage('Memverifikasi identitas di server...');

      try {
        const verifyRes = await fetch('/api/face/verify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            purpose: normalizedPurpose,
            subject_type: subjectType,
            descriptors: [descriptor],
          }),
        });

        const verifyJson = (await verifyRes.json()) as {
          status?: 'accepted' | 'confirm' | 'rejected' | 'retry';
          verification_id?: string;
          subject?: { id: string; name: string; subtitle: string; code?: string };
          candidates?: ConfirmCandidate[];
          score?: number | null;
          margin?: number | null;
          reason?: string;
          bestScore?: number | null;
        };

        if (showDebug) {
          setDebugMetrics((prev) => ({
            ...prev,
            lastScore: verifyJson.score ?? verifyJson.bestScore ?? null,
            lastMargin: verifyJson.margin ?? null,
          }));
        }

        // 1. ZONA ACCEPT: Terverifikasi Yakin (Skor Ketat <= 0.32)
        if (verifyJson.status === 'accepted' && verifyJson.verification_id && verifyJson.subject) {
          playBeep(1174, 150); // Nada sukses
          setStatusTone('success');
          setStatusMessage(`Terverifikasi: ${verifyJson.subject.name}`);
          await onResult({
            verification_id: verifyJson.verification_id,
            subject_type: subjectType,
            subject_id: verifyJson.subject.id,
            name: verifyJson.subject.name,
            subtitle: verifyJson.subject.subtitle,
            code: verifyJson.subject.code,
          });
          processingRef.current = false;
          return;
        }

        // 2. ZONA CONFIRM: Skor 0.32 - 0.40 (Perlu konfirmasi nama karyawan)
        if (verifyJson.status === 'confirm' && verifyJson.verification_id && verifyJson.candidates) {
          setStatusTone('warn');
          setStatusMessage('Silakan konfirmasi nama Anda');
          setConfirmVerificationId(verifyJson.verification_id);
          setConfirmCandidates(verifyJson.candidates);
          setConfirmOpen(true);
          processingRef.current = false;
          return;
        }

        // 3. RETRY: Posisi goyang / perlu stabil
        if (verifyJson.status === 'retry') {
          setStatusTone('warn');
          setStatusMessage(verifyJson.reason ?? 'Coba hadap lurus ke kamera');
          cooldownUntilRef.current = Date.now() + 600;
          processingRef.current = false;
          resetCaptureState();
          return;
        }

        // 4. ZONA REJECT: Wajah Tidak Dikenali (Skor > 0.40)
        setFailCount((prev) => prev + 1);
        setStatusTone('error');
        setStatusMessage('Wajah tidak dikenali dalam sistem. Silakan coba lagi.');
        cooldownUntilRef.current = Date.now() + 1200;
        processingRef.current = false;
        resetCaptureState();
      } catch {
        resetCaptureState();
        processingRef.current = false;
        setStatusTone('error');
        setStatusMessage('Gagal menghubungi server verifikasi.');
        cooldownUntilRef.current = Date.now() + 1000;
      }
    },
    [normalizedPurpose, onResult, resetCaptureState, showDebug, subjectType]
  );

  // Inisialisasi Kamera & Model AI
  useEffect(() => {
    let cancelled = false;

    async function setup() {
      setCameraReady(false);
      setModelsReady(false);
      setCameraError(null);
      setStatusTone('neutral');
      setStatusMessage('Menyalakan kamera...');

      try {
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
          throw new Error('UNSUPPORTED_CAMERA');
        }

        // Resolusi ideal 720x960 portrait dengan fallback otomatis ke yang tersedia
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: 'user',
            width: { ideal: 720, min: 480 },
            height: { ideal: 960, min: 640 },
            frameRate: { ideal: 24, max: 30 },
          },
          audio: false,
        });

        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }

        streamRef.current = stream;

        const video = videoRef.current;
        if (!video) return;

        video.srcObject = stream;
        video.setAttribute('playsinline', 'true');
        video.muted = true;

        await new Promise<void>((resolve) => {
          if (video.readyState >= 2) {
            resolve();
            return;
          }
          video.onloadedmetadata = () => resolve();
        });

        if (cancelled) return;

        await video.play();
        setCameraReady(true);
        setStatusMessage('Menyiapkan model AI...');

        // Inisialisasi model MediaPipe dan face-api
        await Promise.all([getFaceLandmarker(), ensureFaceModelsLoaded()]);

        if (cancelled) return;
        setModelsReady(true);
        setStatusTone('neutral');
        setStatusMessage('Posisikan wajah Anda di depan kamera');
      } catch (err: unknown) {
        if (cancelled) return;
        stopCamera();
        setCameraReady(false);
        setModelsReady(false);

        const errMsg = err instanceof Error ? err.message : String(err);
        if (errMsg === 'UNSUPPORTED_CAMERA') {
          setCameraError('Perangkat Anda tidak mendukung akses kamera.');
        } else if (errMsg.includes('NotAllowedError') || errMsg.includes('Permission')) {
          setCameraError('Izin kamera ditolak. Berikan izin kamera di pengaturan browser.');
        } else if (errMsg.includes('NotFoundError')) {
          setCameraError('Kamera tidak ditemukan pada perangkat ini.');
        } else {
          setCameraError('Gagal mengakses kamera. Muat ulang halaman.');
        }
      }
    }

    setup();

    return () => {
      cancelled = true;
      stopCamera();
    };
  }, [retryCounter, stopCamera]);

  // Loop Pendeteksian Wajah Otomatis Cepat
  useEffect(() => {
    if (!cameraReady || !modelsReady || paused || confirmOpen) {
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      return;
    }

    let active = true;

    const scheduleNext = (delayMs: number) => {
      if (!active) return;
      if (timerRef.current !== null) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(runLoop, delayMs);
    };

    const runLoop = async () => {
      if (!active || processingRef.current) return;

      const video = videoRef.current;
      if (!video || video.readyState < 2 || video.paused || video.ended) {
        scheduleNext(100);
        return;
      }

      if (Date.now() < cooldownUntilRef.current) {
        scheduleNext(120);
        return;
      }

      try {
        const sampleCanvas = capturePortraitSampleCanvas(video);
        if (!sampleCanvas) {
          scheduleNext(120);
          return;
        }

        const landmarker = await getFaceLandmarker();
        const mpRes = landmarker.detectForVideo(sampleCanvas, performance.now());
        const analysis = analyzeMediaPipeResult(mpRes, video, pitchFrontalRef.current);

        if (showDebug) {
          setDebugMetrics((prev) => ({
            ...prev,
            widthPx: analysis.box?.widthPx ? Math.round(analysis.box.widthPx) : 0,
            yaw: Number(analysis.yaw.toFixed(2)),
            pitch: Number(analysis.pitch.toFixed(2)),
            rollDeg: Number(analysis.rollDeg.toFixed(1)),
          }));
        }

        // Jika wajah belum lolos gate geometris / pose MediaPipe
        if (!analysis.statusOk || !analysis.box) {
          resetCaptureState();
          lastBoxRef.current = null;
          setStatusTone('neutral');
          setStatusMessage(analysis.message);
          scheduleNext(150);
          return;
        }

        lastBoxRef.current = analysis.box;

        // Kalibrasi pitch frontal jika belum diset
        if (pitchFrontalRef.current === 0) {
          pitchFrontalRef.current = analysis.pitch;
        }

        const now = Date.now();

        // Cek kestabilan posisi wajah minimal 150ms sebelum memindai
        if (stableStartTimeRef.current === null) {
          stableStartTimeRef.current = now;
          setStatusTone('ready');
          setStatusMessage('Tahan posisi wajah...');
          scheduleNext(80);
          return;
        }

        const stableDuration = now - stableStartTimeRef.current;
        if (stableDuration < 150) {
          setStatusTone('ready');
          setStatusMessage('Tahan posisi wajah...');
          scheduleNext(60);
          return;
        }

        // Wajah stabil: Picu verifikasi instan!
        await performFaceCapture(analysis.box);
        scheduleNext(250);
      } catch {
        resetCaptureState();
        processingRef.current = false;
        scheduleNext(250);
      }
    };

    scheduleNext(150);

    return () => {
      active = false;
      if (timerRef.current !== null) clearTimeout(timerRef.current);
    };
  }, [cameraReady, modelsReady, paused, confirmOpen, performFaceCapture, resetCaptureState, showDebug]);

  return (
    <div className="w-full flex flex-col items-center gap-3">
      {(title || subtitle) && (
        <div className="text-center">
          {title && <h2 className="text-sm font-bold text-ink">{title}</h2>}
          {subtitle && <p className="text-xs text-ink-muted">{subtitle}</p>}
        </div>
      )}

      {/* Container Kamera Portrait */}
      <div
        onClick={() => {
          if (lastBoxRef.current && !processingRef.current && cameraReady && modelsReady) {
            performFaceCapture(lastBoxRef.current);
          }
        }}
        className="relative w-full aspect-[3/4] max-w-sm rounded-3xl overflow-hidden bg-slate-900 border-2 border-border-sky shadow-card flex items-center justify-center cursor-pointer select-none"
        title="Klik untuk memindai wajah langsung"
      >
        {/* Feed Video Kamera */}
        <video
          ref={videoRef}
          className="absolute inset-0 w-full h-full object-cover -scale-x-100"
          playsInline
          muted
        />

        {/* Overlay Bingkai Wajah Oval */}
        <div className="absolute inset-0 pointer-events-none flex flex-col items-center justify-center">
          <div
            className={`w-56 h-72 rounded-[48%] border-2 transition-colors duration-300 ${
              statusTone === 'success'
                ? 'border-emerald-400 shadow-[0_0_24px_rgba(52,211,153,0.45)]'
                : statusTone === 'ready'
                ? 'border-primary-400 shadow-[0_0_20px_rgba(56,189,248,0.35)]'
                : statusTone === 'warn'
                ? 'border-amber-400 shadow-[0_0_20px_rgba(251,191,36,0.35)]'
                : statusTone === 'error'
                ? 'border-rose-400 shadow-[0_0_20px_rgba(244,63,94,0.35)]'
                : 'border-white/50'
            }`}
          />
        </div>

        {/* Loading Spinner State */}
        {(!cameraReady || !modelsReady) && !cameraError && (
          <div className="absolute inset-0 bg-slate-950/80 backdrop-blur-sm flex flex-col items-center justify-center gap-3 p-4 text-center">
            <Loader2 className="w-10 h-10 text-primary-400 animate-spin" />
            <div className="text-sm font-bold text-white tracking-wide">
              {statusMessage}
            </div>
            <div className="text-xs text-slate-400">
              Menyiapkan kamera dan model kecerdasan buatan...
            </div>
          </div>
        )}

        {/* Error State */}
        {cameraError && (
          <div className="absolute inset-0 bg-slate-950/90 backdrop-blur-md flex flex-col items-center justify-center gap-3 p-6 text-center">
            <div className="w-14 h-14 rounded-2xl bg-danger/20 text-danger flex items-center justify-center mb-1">
              <AlertCircle className="w-8 h-8" />
            </div>
            <div className="text-base font-extrabold text-white">Kamera Bermasalah</div>
            <div className="text-xs text-slate-300 leading-relaxed max-w-xs">
              {cameraError}
            </div>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setRetryCounter((p) => p + 1);
              }}
              className="mt-2 inline-flex items-center gap-2 rounded-xl bg-primary-600 hover:bg-primary-700 text-white px-4 py-2 text-xs font-bold transition shadow-soft"
            >
              <RefreshCw className="w-4 h-4" />
              <span>Coba Lagi</span>
            </button>
          </div>
        )}

        {/* Tombol Batal Melayang */}
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onCancel();
          }}
          className="absolute top-3 right-3 w-10 h-10 rounded-full bg-slate-900/60 hover:bg-slate-900/90 text-white flex items-center justify-center backdrop-blur-sm transition border border-white/20 active:scale-95 z-20"
          title="Batal"
        >
          <X className="w-5 h-5" />
        </button>

        {/* Status Badge Melayang di Bagian Bawah Kamera */}
        <div className="absolute bottom-3 inset-x-3 pointer-events-none z-20">
          <div
            className={`rounded-2xl px-4 py-2.5 backdrop-blur-md border text-center transition-all duration-200 shadow-md ${
              statusTone === 'success'
                ? 'bg-emerald-950/80 border-emerald-500/40 text-emerald-200'
                : statusTone === 'ready'
                ? 'bg-sky-950/80 border-sky-500/40 text-sky-200'
                : statusTone === 'warn'
                ? 'bg-amber-950/80 border-amber-500/40 text-amber-200'
                : statusTone === 'error'
                ? 'bg-rose-950/80 border-rose-500/40 text-rose-200'
                : 'bg-slate-950/80 border-white/20 text-slate-200'
            }`}
          >
            <div className="text-xs font-bold leading-snug">{statusMessage}</div>
          </div>
        </div>

        {/* Debug Overlay (Khusus jika URL memiliki parameter ?debug=1) */}
        {showDebug && (
          <div className="absolute top-3 left-3 bg-slate-950/85 backdrop-blur-md p-2.5 rounded-xl border border-white/20 text-[10px] font-mono text-emerald-300 pointer-events-none space-y-0.5 z-10 max-w-[190px]">
            <div className="font-bold text-amber-300">DEBUG OVERLAY</div>
            <div>Face W: {debugMetrics.widthPx ?? 0}px</div>
            <div>Yaw: {debugMetrics.yaw ?? 0} | Pit: {debugMetrics.pitch ?? 0}</div>
            <div>Roll: {debugMetrics.rollDeg ?? 0}°</div>
            {debugMetrics.cropMetrics && (
              <>
                <div>Lum: {debugMetrics.cropMetrics.brightness} (45-230)</div>
                <div>L/R: {debugMetrics.cropMetrics.lrRatio} (0.45-2.2)</div>
                <div>Clip: {debugMetrics.cropMetrics.clippedPct}% (&lt;20%)</div>
                <div>Sharp: {debugMetrics.cropMetrics.sharpness} (&gt;25)</div>
              </>
            )}
            <div>Score: {debugMetrics.lastScore?.toFixed(3) ?? '-'}</div>
            <div>Margin: {debugMetrics.lastMargin?.toFixed(3) ?? '-'}</div>
          </div>
        )}
      </div>

      {/* Tombol Scan Cepat Manual */}
      {cameraReady && modelsReady && !paused && !confirmOpen && (
        <button
          type="button"
          onClick={() => {
            if (lastBoxRef.current) {
              performFaceCapture(lastBoxRef.current);
            } else {
              setStatusMessage('Posisikan wajah di dalam oval terlebih dahulu');
            }
          }}
          disabled={processingRef.current}
          className="inline-flex items-center gap-2 rounded-2xl bg-primary-600 hover:bg-primary-700 active:scale-95 text-white font-bold text-xs sm:text-sm px-6 py-2.5 shadow-md transition disabled:opacity-50"
        >
          <ScanFace className="w-4 h-4 text-white" />
          <span>Scan Sekarang</span>
        </button>
      )}

      {/* Tautan Bantuan Jika Gagal Scan Beberapa Kali */}
      {failCount >= 3 && showEnrollHintLink && (
        <div className="rounded-2xl bg-amber-50 border border-amber-200 p-3.5 max-w-sm w-full text-center space-y-1.5 animate-fadeIn">
          <div className="text-xs font-bold text-amber-900">
            Wajah belum terdeteksi dengan tepat?
          </div>
          <div className="text-[11px] text-amber-700 leading-relaxed">
            Pastikan wajah berada di pencahayaan ruangan yang cukup dan lepas masker/topi. Anda juga dapat mendaftarkan wajah kembali.
          </div>
          <Link
            href="/absen/daftar-wajah"
            className="inline-flex items-center gap-1.5 text-xs font-extrabold text-primary-700 hover:underline pt-0.5"
          >
            <ScanFace className="w-3.5 h-3.5" />
            <span>Ke Halaman Pendaftaran Wajah</span>
          </Link>
        </div>
      )}

      {/* Sheet Konfirmasi Identitas (Zona Confirm) */}
      <ConfirmIdentitySheet
        open={confirmOpen}
        verificationId={confirmVerificationId}
        subjectType={subjectType}
        candidates={confirmCandidates}
        onConfirmed={async (confirmedSubject) => {
          setConfirmOpen(false);
          setStatusTone('success');
          setStatusMessage(`Terverifikasi: ${confirmedSubject.name}`);
          await onResult({
            verification_id: confirmVerificationId,
            subject_type: subjectType,
            subject_id: confirmedSubject.id,
            name: confirmedSubject.name,
            subtitle: confirmedSubject.subtitle,
            code: confirmedSubject.code,
          });
        }}
        onCancel={() => {
          setConfirmOpen(false);
          resetCaptureState();
          cooldownUntilRef.current = Date.now() + 600;
        }}
      />
    </div>
  );
}
