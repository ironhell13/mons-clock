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

type LivenessChallenge = 'blink' | 'head_turn';

function pickChallenge(): LivenessChallenge {
  return Math.random() < 0.5 ? 'blink' : 'head_turn';
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
  const steadyCountRef = useRef<number>(0);
  const challengeRef = useRef<LivenessChallenge>(pickChallenge());
  const prevNosePosRef = useRef<{ x: number; y: number } | null>(null);
  const motionAccumRef = useRef<number>(0);

  const [initializing, setInitializing] = useState(true);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState('Menyiapkan kamera dan model wajah...');
  const [statusTone, setStatusTone] = useState<'neutral' | 'ready' | 'success' | 'warn' | 'error'>('neutral');
  const [livenessHint, setLivenessHint] = useState<string>(
    challengeRef.current === 'blink'
      ? 'Berkedip satu kali secara natural'
      : 'Gerakkan kepala sedikit ke kiri/kanan'
  );
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
    const next = pickChallenge();
    challengeRef.current = next;
    livenessPassedRef.current = false;
    steadyCountRef.current = 0;
    motionAccumRef.current = 0;
    prevNosePosRef.current = null;
    setLivenessHint(
      next === 'blink'
        ? 'Berkedip satu kali secara natural'
        : 'Gerakkan kepala sedikit ke kiri/kanan'
    );
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function setup() {
      setInitializing(true);
      setCameraError(null);
      setStatusTone('neutral');
      setStatusMessage('Memuat model pengenalan wajah...');

      try {
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
          throw new Error('UNSUPPORTED_CAMERA');
        }

        const [stream, templates] = await Promise.all([
          navigator.mediaDevices.getUserMedia({
            video: {
              facingMode: 'user',
              width: { ideal: 1280 },
              height: { ideal: 720 },
            },
            audio: false,
          }),
          getCachedFaceTemplates(purpose),
          getFaceLandmarker(),
          ensureFaceModelsLoaded(),
        ]);

        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }

        streamRef.current = stream;
        templatesRef.current = templates;
        lastCacheRefreshRef.current = Date.now();

        const videoEl = videoRef.current;
        if (videoEl) {
          videoEl.srcObject = stream;
          await videoEl.play();
        }

        if (templates.length === 0) {
          setStatusTone('warn');
          setStatusMessage(
            purpose === 'employee'
              ? 'Belum ada wajah karyawan yang terdaftar.'
              : 'Belum ada wajah pengawal yang terdaftar.'
          );
        } else {
          setStatusTone('neutral');
          setStatusMessage('Posisikan wajah di dalam bingkai');
        }
        setInitializing(false);
      } catch (err) {
        if (cancelled) return;
        stopCamera();
        setInitializing(false);

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

  // Loop deteksi MediaPipe ~8-10 fps, berhenti otomatis saat tab tidak aktif
  useEffect(() => {
    if (initializing || cameraError || paused) return;

    let active = true;

    const tick = async (timestamp: number) => {
      if (!active) return;
      rafRef.current = requestAnimationFrame(tick);

      if (document.hidden) return;
      if (processingRef.current) return;
      if (Date.now() < cooldownUntilRef.current) return;
      if (timestamp - lastDetectMsRef.current < 115) return;

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
          steadyCountRef.current = 0;
          setStatusTone('neutral');
          setStatusMessage(analysis.message);
          return;
        }

        // Hitung gerakan alami (anti foto statis)
        const nose = mpRes.faceLandmarks[0]?.[1];
        if (nose && prevNosePosRef.current) {
          const dist = Math.hypot(
            nose.x - prevNosePosRef.current.x,
            nose.y - prevNosePosRef.current.y
          );
          motionAccumRef.current += dist;
        }
        if (nose) {
          prevNosePosRef.current = { x: nose.x, y: nose.y };
        }

        // Cek tantangan liveness ringan
        if (!livenessPassedRef.current) {
          const challenge = challengeRef.current;
          if (challenge === 'blink' && analysis.isBlinking) {
            livenessPassedRef.current = true;
          } else if (challenge === 'head_turn' && Math.abs(analysis.yaw) > 0.085) {
            livenessPassedRef.current = true;
          } else {
            setStatusTone('ready');
            setStatusMessage(livenessHint);
            return;
          }
        }

        // Setelah liveness terpenuhi, tunggu posisi lurus & stabil
        if (Math.abs(analysis.yaw) > 0.17 || Math.abs(analysis.pitch) > 0.18) {
          steadyCountRef.current = 0;
          setStatusTone('ready');
          setStatusMessage('Hadapkan wajah lurus ke kamera');
          return;
        }

        steadyCountRef.current += 1;
        if (steadyCountRef.current < 2) {
          setStatusTone('ready');
          setStatusMessage('Tahan sebentar...');
          return;
        }

        const frameQuality = checkVideoFrameQuality(video);
        if (!frameQuality.ok) {
          setStatusTone('warn');
          setStatusMessage(frameQuality.reason ?? 'Sesuaikan pencahayaan dan stabilitas kamera');
          return;
        }

        // Jalankan face-api descriptor + pencocokan
        processingRef.current = true;
        setStatusTone('ready');
        setStatusMessage('Memverifikasi identitas wajah...');

        const descriptor = await extractFaceDescriptor(video);
        if (!descriptor) {
          processingRef.current = false;
          steadyCountRef.current = 0;
          setStatusTone('warn');
          setStatusMessage('Wajah kurang jelas, tahan sebentar...');
          return;
        }

        const outcome = matchDescriptor(descriptor, templatesRef.current);

        if (outcome.matched) {
          cooldownUntilRef.current = Date.now() + 3000;
          setStatusTone('success');
          setStatusMessage(`Terdeteksi: ${outcome.name}`);
          setFailCount(0);
          resetChallenge();
          await onResult(outcome);
          processingRef.current = false;
          return;
        }

        // Gagal cocok: tampilkan pesan dan scan ulang otomatis setelah jeda singkat
        cooldownUntilRef.current = Date.now() + 1400;
        setFailCount((prev) => prev + 1);
        setStatusTone('error');
        setStatusMessage(
          outcome.reason === 'ambiguous'
            ? 'Wajah mirip dengan profil lain, posisikan ulang lebih jelas'
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
        steadyCountRef.current = 0;
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
  }, [cameraError, initializing, livenessHint, onResult, paused, purpose, resetChallenge]);

  const toneBadgeClasses = {
    neutral: 'bg-slate-900/75 text-white border-white/20',
    ready: 'bg-primary-600/90 text-white border-primary-300',
    success: 'bg-emerald-600/95 text-white border-emerald-300',
    warn: 'bg-amber-600/90 text-white border-amber-300',
    error: 'bg-red-600/95 text-white border-red-300',
  }[statusTone];

  return (
    <div className="w-full max-w-4xl mx-auto rounded-2xl bg-surface border-2 border-border-sky shadow-card overflow-hidden">
      <div className="px-6 py-4 border-b border-border-sky flex items-center justify-between gap-4 bg-white">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-primary-100 text-primary-700 flex items-center justify-center">
            <ScanFace className="w-6 h-6" />
          </div>
          <div>
            <h2 className="text-lg font-extrabold text-ink">
              {title ?? (purpose === 'employee' ? 'Scan Wajah Karyawan' : 'Scan Wajah Pengawal')}
            </h2>
            <p className="text-xs text-ink-muted">
              {subtitle ?? 'Posisikan wajah di dalam bingkai oval dan ikuti instruksi singkat.'}
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={() => {
            stopCamera();
            onCancel();
          }}
          className="inline-flex items-center gap-1.5 rounded-xl border border-border-sky bg-white hover:bg-page px-4 py-2.5 text-sm font-semibold text-ink transition min-h-[44px]"
        >
          <X className="w-4 h-4" />
          <span>Batal</span>
        </button>
      </div>

      <div className="relative bg-slate-950 aspect-video max-h-[520px] w-full flex items-center justify-center overflow-hidden">
        <video
          ref={videoRef}
          playsInline
          muted
          autoPlay
          className="w-full h-full object-cover mirror-video"
        />

        {/* Overlay Oval Panduan */}
        {!cameraError && (
          <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
            <div
              className={`w-56 h-72 sm:w-64 sm:h-80 rounded-[999px] border-4 transition-colors duration-300 shadow-[0_0_0_9999px_rgba(15,23,42,0.42)] ${
                statusTone === 'success'
                  ? 'border-emerald-400'
                  : statusTone === 'error'
                    ? 'border-red-400'
                    : statusTone === 'ready'
                      ? 'border-primary'
                      : 'border-white/75'
              }`}
            />
          </div>
        )}

        {/* Loading Overlay */}
        {initializing && !cameraError && (
          <div className="absolute inset-0 bg-slate-950/80 flex flex-col items-center justify-center text-white gap-3 p-6 text-center">
            <Loader2 className="w-10 h-10 animate-spin text-primary" />
            <p className="text-base font-bold">Menyalakan kamera & memuat model AI...</p>
            <p className="text-xs text-slate-300">Mohon tunggu beberapa detik pada scan pertama.</p>
          </div>
        )}

        {/* Camera Error Overlay */}
        {cameraError && (
          <div className="absolute inset-0 bg-slate-900/95 flex flex-col items-center justify-center text-white gap-4 p-8 text-center">
            <div className="w-14 h-14 rounded-2xl bg-danger/20 text-red-400 flex items-center justify-center">
              <Camera className="w-8 h-8" />
            </div>
            <div className="max-w-md space-y-1.5">
              <h3 className="text-lg font-bold">Kamera Tidak Dapat Diakses</h3>
              <p className="text-sm text-slate-300">{cameraError}</p>
            </div>
            <button
              type="button"
              onClick={() => setRetryCounter((c) => c + 1)}
              className="inline-flex items-center gap-2 rounded-xl bg-primary-600 hover:bg-primary-700 text-white px-5 py-3 text-sm font-bold transition min-h-[48px]"
            >
              <RefreshCw className="w-4 h-4" />
              <span>Coba Lagi</span>
            </button>
          </div>
        )}

        {/* Live Status Pill */}
        {!initializing && !cameraError && (
          <div className="absolute bottom-5 inset-x-4 flex flex-col items-center gap-2">
            <div
              className={`inline-flex items-center gap-2 rounded-2xl border px-5 py-2.5 text-sm sm:text-base font-bold shadow-lg backdrop-blur-md transition ${toneBadgeClasses}`}
            >
              {statusTone === 'success' ? (
                <CheckCircle2 className="w-5 h-5 shrink-0" />
              ) : statusTone === 'error' ? (
                <AlertCircle className="w-5 h-5 shrink-0" />
              ) : (
                <Sparkles className="w-5 h-5 shrink-0" />
              )}
              <span>{statusMessage}</span>
            </div>
          </div>
        )}
      </div>

      {/* Fail 3x warning & suggestion */}
      {failCount >= 3 && (
        <div className="px-6 py-3.5 bg-amber-50 border-t border-amber-200 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 text-sm text-amber-900 font-medium">
            <AlertCircle className="w-5 h-5 text-amber-600 shrink-0" />
            <span>
              Wajah gagal dikenali 3 kali. Pastikan pencahayaan cukup, atau hubungi admin untuk{' '}
              <strong>Daftar Wajah</strong>.
            </span>
          </div>
          {showEnrollHintLink && (
            <Link
              href="/absen/daftar-wajah"
              className="rounded-xl bg-amber-600 hover:bg-amber-700 text-white px-4 py-2 text-xs font-bold transition"
            >
              Buka Daftar Wajah
            </Link>
          )}
        </div>
      )}
    </div>
  );
}

