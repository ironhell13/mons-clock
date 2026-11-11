'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import {
  AlertCircle,
  Camera,
  CheckCircle2,
  Loader2,
  RefreshCw,
  ScanFace,
  Sparkles,
  X,
} from 'lucide-react';
import type { SubjectType } from '@/types/database';
import {
  ensureFaceModelsLoaded,
  extractFaceDescriptor,
  getCachedFaceTemplates,
  matchDescriptor,
  type CachedFaceTemplate,
  type FaceMatchSuccess,
} from '@/lib/face';
import {
  analyzeMediaPipeResult,
  checkVideoFrameQuality,
  getFaceLandmarker,
} from '@/lib/mediapipe';

export interface FaceScannerProps {
  purpose: SubjectType;
  title?: string;
  subtitle?: string;
  onResult: (result: FaceMatchSuccess) => void | Promise<void>;
  onCancel: () => void;
  paused?: boolean;
  showEnrollHintLink?: boolean;
}

export function FaceScanner({
  purpose,
  title,
  subtitle,
  onResult,
  onCancel,
  paused = false,
  showEnrollHintLink = true,
}: FaceScannerProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);
  const lastDetectMsRef = useRef<number>(0);
  const lastCacheRefreshRef = useRef<number>(0);
  const templatesRef = useRef<CachedFaceTemplate[]>([]);
  const processingRef = useRef<boolean>(false);
  const cooldownUntilRef = useRef<number>(0);
  const livenessPassedRef = useRef<boolean>(false);
  const prevNosePosRef = useRef<{ x: number; y: number } | null>(null);
  const motionAccumRef = useRef<number>(0);
  const pendingConfirmRef = useRef<{ subjectId: string; count: number } | null>(null);

  const [cameraReady, setCameraReady] = useState(false);
  const [modelsReady, setModelsReady] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState('Menyalakan kamera...');
  const [statusTone, setStatusTone] = useState<'neutral' | 'ready' | 'success' | 'warn' | 'error'>('neutral');
  const [failCount, setFailCount] = useState(0);
  const [retryCounter, setRetryCounter] = useState(0);

  const stopCamera = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  }, []);

  const resetChallenge = useCallback(() => {
    livenessPassedRef.current = false;
    motionAccumRef.current = 0;
    prevNosePosRef.current = null;
    pendingConfirmRef.current = null;
  }, []);

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

        // Buka kamera segera dengan resolusi portrait ringan
        const streamPromise = navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: 'user',
            width: { ideal: 720 },
            height: { ideal: 960 },
          },
          audio: false,
        });

        // Paralelkan preload model dan template wajah
        const modelsPromise = Promise.all([
          getCachedFaceTemplates(purpose),
          getFaceLandmarker(),
          ensureFaceModelsLoaded(),
        ]);

        const stream = await streamPromise;
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }

        streamRef.current = stream;
        const videoEl = videoRef.current;
        if (videoEl) {
          videoEl.srcObject = stream;
          await videoEl.play();
        }
        setCameraReady(true);
        setStatusMessage('Menyiapkan pengenalan wajah...');

        const [templates] = await modelsPromise;
        if (cancelled) return;

        templatesRef.current = templates;
        lastCacheRefreshRef.current = Date.now();
        setModelsReady(true);

        if (templates.length === 0) {
          setStatusTone('warn');
          setStatusMessage(
            purpose === 'employee'
              ? 'Belum ada wajah karyawan yang terdaftar.'
              : 'Belum ada wajah pengawal yang terdaftar.'
          );
        } else {
          setStatusTone('neutral');
          setStatusMessage('Posisikan wajah di dalam bingkai oval');
        }
      } catch (err) {
        if (cancelled) return;
        stopCamera();
        setCameraReady(false);
        setModelsReady(false);

        const errorName = err instanceof DOMException ? err.name : '';
        const errMsg = err instanceof Error ? err.message : '';
        if (errorName === 'NotAllowedError' || errorName === 'PermissionDeniedError') {
          setCameraError(
            'Izin kamera ditolak. Mohon izinkan akses kamera pada pengaturan browser tablet.'
          );
        } else if (errorName === 'NotFoundError' || errorName === 'DevicesNotFoundError') {
          setCameraError('Kamera depan tidak ditemukan pada perangkat ini.');
        } else if (errMsg === 'UNSUPPORTED_CAMERA') {
          setCameraError(
            'Browser tidak mendukung akses kamera atau halaman tidak dibuka melalui HTTPS.'
          );
        } else {
          setCameraError(
            'Gagal memuat kamera atau model pengenalan wajah. Periksa koneksi lalu coba lagi.'
          );
        }
      }
    }

    setup();

    return () => {
      cancelled = true;
      stopCamera();
    };
  }, [purpose, retryCounter, stopCamera]);

  // Loop deteksi ~11 fps, berhenti otomatis saat tab tidak aktif
  useEffect(() => {
    if (!cameraReady || !modelsReady || cameraError || paused) return;

    let active = true;

    const tick = async (timestamp: number) => {
      if (!active) return;
      rafRef.current = requestAnimationFrame(tick);

      if (document.hidden) return;
      if (processingRef.current) return;
      if (Date.now() < cooldownUntilRef.current) return;
      if (timestamp - lastDetectMsRef.current < 90) return;

      lastDetectMsRef.current = timestamp;
      const video = videoRef.current;
      if (!video || video.readyState < 2 || !video.videoWidth) return;

      // Refresh cache tiap 3 menit di background
      if (Date.now() - lastCacheRefreshRef.current > 3 * 60 * 1000) {
        lastCacheRefreshRef.current = Date.now();
        getCachedFaceTemplates(purpose, true)
          .then((list) => {
            templatesRef.current = list;
          })
          .catch(() => null);
      }

      if (templatesRef.current.length === 0) {
        setStatusTone('warn');
        setStatusMessage(
          purpose === 'employee'
            ? 'Belum ada wajah karyawan terdaftar. Silakan Daftar Wajah terlebih dahulu.'
            : 'Belum ada wajah pengawal terdaftar. Silakan Daftar Wajah terlebih dahulu.'
        );
        return;
      }

      try {
        const landmarker = await getFaceLandmarker();
        const mpRes = landmarker.detectForVideo(video, performance.now());
        const analysis = analyzeMediaPipeResult(mpRes);

        if (!analysis.statusOk || !analysis.box) {
          pendingConfirmRef.current = null;
          setStatusTone('neutral');
          setStatusMessage(analysis.message);
          return;
        }

        // Liveness alami: berkedip atau gerakan kepala alami ringan (tolak foto statis)
        const nose = mpRes.faceLandmarks[0]?.[1];
        if (nose && prevNosePosRef.current) {
          const dist = Math.hypot(
            nose.x - prevNosePosRef.current.x,
            nose.y - prevNosePosRef.current.y
          );
          if (dist > 0.0015) {
            motionAccumRef.current += dist;
          }
        }
        if (nose) {
          prevNosePosRef.current = { x: nose.x, y: nose.y };
        }

        if (!livenessPassedRef.current) {
          if (
            analysis.isBlinking ||
            motionAccumRef.current >= 0.012 ||
            Math.abs(analysis.yaw) >= 0.055
          ) {
            livenessPassedRef.current = true;
          } else {
            setStatusTone('ready');
            setStatusMessage('Berkedip atau gerakkan wajah sedikit');
            return;
          }
        }

        // Pastikan wajah cukup menghadap depan saat ekstrak descriptor agar akurat
        if (Math.abs(analysis.yaw) > 0.14) {
          setStatusTone('ready');
          setStatusMessage('Hadapkan wajah lurus ke kamera');
          return;
        }

        const frameQuality = checkVideoFrameQuality(video);
        if (!frameQuality.ok) {
          setStatusTone('warn');
          setStatusMessage(frameQuality.reason ?? 'Sesuaikan pencahayaan dan stabilitas kamera');
          return;
        }

        processingRef.current = true;
        setStatusTone('ready');
        setStatusMessage('Memverifikasi wajah...');

        const descriptor = await extractFaceDescriptor(video, analysis.box);
        if (!descriptor) {
          processingRef.current = false;
          setStatusTone('warn');
          setStatusMessage('Wajah kurang jelas, tahan sebentar...');
          return;
        }

        const outcome = matchDescriptor(descriptor, templatesRef.current);

        if (outcome.matched) {
          // Jika jarak > 0.33, wajib konfirmasi 2 frame berturut-turut untuk cegah salah orang
          if (outcome.distance > 0.33) {
            const prev = pendingConfirmRef.current;
            if (!prev || prev.subjectId !== outcome.subject_id) {
              pendingConfirmRef.current = { subjectId: outcome.subject_id, count: 1 };
              processingRef.current = false;
              setStatusTone('ready');
              setStatusMessage('Memastikan identitas...');
              return;
            }
          }

          cooldownUntilRef.current = Date.now() + 3000;
          setStatusTone('success');
          setStatusMessage(`Terdeteksi: ${outcome.name}`);
          setFailCount(0);
          resetChallenge();
          await onResult(outcome);
          processingRef.current = false;
          return;
        }

        // Tidak cocok atau ambigu
        pendingConfirmRef.current = null;
        cooldownUntilRef.current = Date.now() + 900;
        setFailCount((prev) => prev + 1);
        setStatusTone('error');
        setStatusMessage(
          outcome.reason === 'ambiguous'
            ? 'Wajah mirip dengan profil lain, hadap lurus lebih jelas'
            : 'Wajah tidak dikenali, coba lagi'
        );
        resetChallenge();
        processingRef.current = false;
      } catch {
        processingRef.current = false;
      }
    };

    rafRef.current = requestAnimationFrame(tick);

    const handleVisibility = () => {
      if (document.hidden) {
        pendingConfirmRef.current = null;
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      active = false;
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [cameraError, cameraReady, modelsReady, onResult, paused, purpose, resetChallenge]);

  const toneBadgeClasses = {
    neutral: 'bg-slate-900/80 text-white border-white/20',
    ready: 'bg-primary-600/95 text-white border-primary-300',
    success: 'bg-emerald-600/95 text-white border-emerald-300',
    warn: 'bg-amber-600/95 text-white border-amber-300',
    error: 'bg-red-600/95 text-white border-red-300',
  }[statusTone];

  return (
    <div className="w-full max-w-md mx-auto rounded-2xl bg-surface border-2 border-border-sky shadow-card overflow-hidden">
      <div className="px-4 py-3 border-b border-border-sky flex items-center justify-between gap-3 bg-white">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-9 h-9 rounded-xl bg-primary-100 text-primary-700 flex items-center justify-center shrink-0">
            <ScanFace className="w-5 h-5" />
          </div>
          <div className="min-w-0">
            <h2 className="text-base font-extrabold text-ink truncate">
              {title ?? (purpose === 'employee' ? 'Scan Wajah Karyawan' : 'Scan Wajah Pengawal')}
            </h2>
            {subtitle && <p className="text-[11px] text-ink-muted truncate">{subtitle}</p>}
          </div>
        </div>

        <button
          type="button"
          onClick={() => {
            stopCamera();
            onCancel();
          }}
          className="inline-flex items-center gap-1 rounded-xl border border-border-sky bg-white hover:bg-page px-3 py-2 text-xs font-bold text-ink transition shrink-0 min-h-[40px]"
        >
          <X className="w-4 h-4" />
          <span>Batal</span>
        </button>
      </div>

      {/* Container kamera portrait (3:4) optimal untuk tablet */}
      <div className="relative bg-slate-950 aspect-[3/4] max-h-[68vh] w-full flex items-center justify-center overflow-hidden">
        <video
          ref={videoRef}
          playsInline
          muted
          autoPlay
          className="w-full h-full object-cover mirror-video"
        />

        {/* Overlay Oval Panduan Portrait */}
        {!cameraError && (
          <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
            <div
              className={`w-[64%] h-[62%] rounded-[999px] border-4 transition-colors duration-200 shadow-[0_0_0_9999px_rgba(15,23,42,0.45)] ${
                statusTone === 'success'
                  ? 'border-emerald-400'
                  : statusTone === 'error'
                    ? 'border-red-400'
                    : statusTone === 'ready'
                      ? 'border-primary'
                      : 'border-white/80'
              }`}
            />
          </div>
        )}

        {/* Loading Overlay hanya saat kamera belum menyala */}
        {!cameraReady && !cameraError && (
          <div className="absolute inset-0 bg-slate-950/85 flex flex-col items-center justify-center text-white gap-3 p-6 text-center">
            <Loader2 className="w-10 h-10 animate-spin text-primary" />
            <p className="text-sm font-bold">Menyalakan kamera depan...</p>
          </div>
        )}

        {/* Camera Error Overlay */}
        {cameraError && (
          <div className="absolute inset-0 bg-slate-900/95 flex flex-col items-center justify-center text-white gap-4 p-6 text-center">
            <div className="w-14 h-14 rounded-2xl bg-danger/20 text-red-400 flex items-center justify-center">
              <Camera className="w-8 h-8" />
            </div>
            <div className="max-w-xs space-y-1.5">
              <h3 className="text-base font-bold">Kamera Tidak Dapat Diakses</h3>
              <p className="text-xs text-slate-300">{cameraError}</p>
            </div>
            <button
              type="button"
              onClick={() => setRetryCounter((c) => c + 1)}
              className="inline-flex items-center gap-2 rounded-xl bg-primary-600 hover:bg-primary-700 text-white px-5 py-3 text-sm font-bold transition min-h-[44px]"
            >
              <RefreshCw className="w-4 h-4" />
              <span>Coba Lagi</span>
            </button>
          </div>
        )}

        {/* Live Status Pill */}
        {cameraReady && !cameraError && (
          <div className="absolute bottom-4 inset-x-3 flex justify-center">
            <div
              className={`inline-flex items-center gap-2 rounded-2xl border px-4 py-2 text-xs sm:text-sm font-bold shadow-lg backdrop-blur-md transition ${toneBadgeClasses}`}
            >
              {!modelsReady ? (
                <Loader2 className="w-4 h-4 animate-spin shrink-0" />
              ) : statusTone === 'success' ? (
                <CheckCircle2 className="w-4 h-4 shrink-0" />
              ) : statusTone === 'error' ? (
                <AlertCircle className="w-4 h-4 shrink-0" />
              ) : (
                <Sparkles className="w-4 h-4 shrink-0" />
              )}
              <span>{statusMessage}</span>
            </div>
          </div>
        )}
      </div>

      {failCount >= 3 && (
        <div className="px-4 py-3 bg-amber-50 border-t border-amber-200 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-xs text-amber-900 font-medium">
            <AlertCircle className="w-4 h-4 text-amber-600 shrink-0" />
            <span>Gagal 3 kali? Pastikan cahaya terang atau daftar ulang wajah.</span>
          </div>
          {showEnrollHintLink && (
            <Link
              href="/absen/daftar-wajah"
              className="rounded-lg bg-amber-600 hover:bg-amber-700 text-white px-3 py-1.5 text-xs font-bold transition"
            >
              Daftar Wajah
            </Link>
          )}
        </div>
      )}
    </div>
  );
}
