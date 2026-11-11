'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  Camera,
  CheckCircle2,
  Loader2,
  RefreshCw,
  ShieldCheck,
} from 'lucide-react';
import { toast } from 'sonner';
import type { SubjectType } from '@/types/database';
import {
  ensureFaceModelsLoaded,
  extractFaceDescriptor,
  getCachedFaceTemplates,
  getFaceThreshold,
  invalidateFaceTemplatesCache,
  matchDescriptor,
} from '@/lib/face';
import {
  analyzeMediaPipeResult,
  checkVideoFrameQuality,
  getFaceLandmarker,
} from '@/lib/mediapipe';

interface EnrollmentStep {
  key: string;
  label: string;
  instruction: string;
  checkPose: (yaw: number, pitch: number) => boolean;
}

const ENROLLMENT_STEPS: EnrollmentStep[] = [
  {
    key: 'lurus',
    label: 'Lurus',
    instruction: 'Hadap lurus ke kamera',
    checkPose: (yaw, pitch) => Math.abs(yaw) <= 0.11 && Math.abs(pitch) <= 0.12,
  },
  {
    key: 'kiri',
    label: 'Kiri',
    instruction: 'Tolehkan wajah sedikit ke kiri',
    checkPose: (yaw) => Math.abs(yaw) >= 0.08 && yaw > 0,
  },
  {
    key: 'kanan',
    label: 'Kanan',
    instruction: 'Tolehkan wajah sedikit ke kanan',
    checkPose: (yaw) => Math.abs(yaw) >= 0.08 && yaw < 0,
  },
  {
    key: 'atas',
    label: 'Atas',
    instruction: 'Angkat dagu sedikit ke atas',
    checkPose: (_yaw, pitch) => pitch <= -0.04,
  },
  {
    key: 'bawah',
    label: 'Bawah',
    instruction: 'Tundukkan dagu sedikit ke bawah',
    checkPose: (_yaw, pitch) => pitch >= 0.05,
  },
];

interface FaceEnrollViewProps {
  subjectType: SubjectType;
  subjectId: string;
  subjectName: string;
  pin?: string;
  onSuccess: (insertedCount: number) => void;
  onCancel: () => void;
}

export function FaceEnrollView({
  subjectType,
  subjectId,
  subjectName,
  pin,
  onSuccess,
  onCancel,
}: FaceEnrollViewProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);
  const lastCheckRef = useRef<number>(0);
  const capturingRef = useRef<boolean>(false);
  const stepHoldRef = useRef<number>(0);
  const stepIndexRef = useRef<number>(0);
  const samplesRef = useRef<{ descriptor: number[]; sample_label: string }[]>([]);
  const lastCaptureAtRef = useRef<number>(0);

  const [initializing, setInitializing] = useState(true);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [stepIndex, setStepIndex] = useState(0);
  const [statusMessage, setStatusMessage] = useState('Menyiapkan kamera...');
  const [saving, setSaving] = useState(false);
  const [duplicateWarning, setDuplicateWarning] = useState<string | null>(null);
  const [retryCounter, setRetryCounter] = useState(0);

  const stopCamera = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  }, []);

  const submitSamples = useCallback(
    async (collected: { descriptor: number[]; sample_label: string }[]) => {
      setSaving(true);
      setStatusMessage('Menyimpan template wajah...');
      try {
        const res = await fetch('/api/face/enroll', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            subject_type: subjectType,
            subject_id: subjectId,
            pin,
            samples: collected,
          }),
        });
        const json = (await res.json()) as { inserted?: number; error?: string };
        if (!res.ok) {
          toast.error(json.error ?? 'Gagal menyimpan pendaftaran wajah.');
          setDuplicateWarning(json.error ?? 'Gagal menyimpan pendaftaran wajah.');
          setSaving(false);
          return;
        }
        invalidateFaceTemplatesCache(subjectType);
        stopCamera();
        onSuccess(json.inserted ?? collected.length);
      } catch {
        toast.error('Terjadi kesalahan jaringan saat menyimpan.');
        setSaving(false);
      }
    },
    [onSuccess, pin, stopCamera, subjectId, subjectType]
  );

  const captureCurrentStep = useCallback(async () => {
    const video = videoRef.current;
    if (!video || capturingRef.current || saving) return;

    const quality = checkVideoFrameQuality(video);
    if (!quality.ok) {
      setStatusMessage(quality.reason ?? 'Kualitas gambar kurang baik.');
      return;
    }

    capturingRef.current = true;
    try {
      const descriptor = await extractFaceDescriptor(video);
      if (!descriptor) {
        setStatusMessage('Wajah gagal diekstrak, posisikan lebih jelas.');
        capturingRef.current = false;
        return;
      }

      // Cek agar wajah tidak terlalu mirip dengan orang lain yang sudah terdaftar
      const allTemplates = await getCachedFaceTemplates(subjectType);
      const otherTemplates = allTemplates.filter((t) => t.subject_id !== subjectId);
      const conflict = matchDescriptor(descriptor, otherTemplates, getFaceThreshold() * 0.92);
      if (conflict.matched) {
        setDuplicateWarning(
          `Wajah terdeteksi mirip dengan "${conflict.name}" yang sudah terdaftar. Pastikan Anda memilih nama yang tepat.`
        );
        capturingRef.current = false;
        return;
      }

      const currentStep = ENROLLMENT_STEPS[stepIndexRef.current];
      const nextSamples = [
        ...samplesRef.current,
        { descriptor, sample_label: currentStep.key },
      ];
      samplesRef.current = nextSamples;
      lastCaptureAtRef.current = Date.now();
      stepHoldRef.current = 0;

      if (nextSamples.length >= ENROLLMENT_STEPS.length) {
        setStepIndex(ENROLLMENT_STEPS.length);
        await submitSamples(nextSamples);
      } else {
        const nextIdx = nextSamples.length;
        stepIndexRef.current = nextIdx;
        setStepIndex(nextIdx);
        setStatusMessage(ENROLLMENT_STEPS[nextIdx].instruction);
      }
    } finally {
      capturingRef.current = false;
    }
  }, [saving, subjectId, subjectType, submitSamples]);

  useEffect(() => {
    let cancelled = false;

    async function setup() {
      setInitializing(true);
      setCameraError(null);
      setDuplicateWarning(null);
      samplesRef.current = [];
      stepIndexRef.current = 0;
      setStepIndex(0);

      try {
        const [stream] = await Promise.all([
          navigator.mediaDevices.getUserMedia({
            video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } },
            audio: false,
          }),
          getFaceLandmarker(),
          ensureFaceModelsLoaded(),
          getCachedFaceTemplates(subjectType),
        ]);

        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }

        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }
        setStatusMessage(ENROLLMENT_STEPS[0].instruction);
        setInitializing(false);
      } catch {
        if (cancelled) return;
        stopCamera();
        setInitializing(false);
        setCameraError('Tidak dapat mengakses kamera atau memuat model wajah.');
      }
    }

    setup();

    return () => {
      cancelled = true;
      stopCamera();
    };
  }, [retryCounter, stopCamera, subjectType]);

  useEffect(() => {
    if (initializing || cameraError || saving || duplicateWarning) return;
    let active = true;

    const tick = async (ts: number) => {
      if (!active) return;
      rafRef.current = requestAnimationFrame(tick);
      if (document.hidden || capturingRef.current) return;
      if (Date.now() - lastCaptureAtRef.current < 900) return;
      if (ts - lastCheckRef.current < 130) return;

      lastCheckRef.current = ts;
      const video = videoRef.current;
      if (!video || video.readyState < 2 || !video.videoWidth) return;

      const idx = stepIndexRef.current;
      if (idx >= ENROLLMENT_STEPS.length) return;
      const step = ENROLLMENT_STEPS[idx];

      try {
        const landmarker = await getFaceLandmarker();
        const mpRes = landmarker.detectForVideo(video, performance.now());
        const analysis = analyzeMediaPipeResult(mpRes);

        if (!analysis.statusOk) {
          stepHoldRef.current = 0;
          setStatusMessage(analysis.message);
          return;
        }

        if (!step.checkPose(analysis.yaw, analysis.pitch)) {
          stepHoldRef.current = 0;
          setStatusMessage(step.instruction);
          return;
        }

        stepHoldRef.current += 1;
        if (stepHoldRef.current >= 2) {
          await captureCurrentStep();
        } else {
          setStatusMessage('Tahan posisi...');
        }
      } catch {
        // lanjut frame berikut
      }
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => {
      active = false;
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, [cameraError, captureCurrentStep, duplicateWarning, initializing, saving]);

  return (
    <div className="space-y-4">
      <div className="rounded-xl bg-primary-50 border border-border-sky px-4 py-3 flex items-start gap-3">
        <ShieldCheck className="w-5 h-5 text-primary-700 shrink-0 mt-0.5" />
        <div className="text-xs text-ink-muted leading-relaxed">
          Pendaftaran wajah untuk <strong className="text-ink">{subjectName}</strong>. Sistem hanya
          menyimpan descriptor numerik (bukan foto wajah) khusus untuk keperluan absensi pos
          security.
        </div>
      </div>

      {/* Stepper 1/5 .. 5/5 */}
      <div className="grid grid-cols-5 gap-2">
        {ENROLLMENT_STEPS.map((step, idx) => {
          const done = idx < stepIndex;
          const active = idx === stepIndex;
          return (
            <div
              key={step.key}
              className={`rounded-xl border px-2 py-2 text-center transition ${
                done
                  ? 'bg-emerald-50 border-emerald-300 text-emerald-800'
                  : active
                    ? 'bg-primary-100 border-primary-500 text-primary-700 font-bold'
                    : 'bg-page border-border-sky text-ink-muted'
              }`}
            >
              <div className="text-[11px] font-bold">
                {done ? '✓' : `${idx + 1}/5`} {step.label}
              </div>
            </div>
          );
        })}
      </div>

      {duplicateWarning && (
        <div className="rounded-xl bg-danger/10 border border-danger/30 px-4 py-3 flex items-start gap-2.5 text-sm text-danger">
          <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="font-semibold">{duplicateWarning}</p>
            <button
              type="button"
              onClick={() => setRetryCounter((c) => c + 1)}
              className="mt-2 rounded-lg bg-danger text-white px-3 py-1.5 text-xs font-bold"
            >
              Ulangi Pendaftaran
            </button>
          </div>
        </div>
      )}

      <div className="relative bg-slate-950 rounded-2xl overflow-hidden aspect-video max-h-[380px] w-full flex items-center justify-center">
        <video
          ref={videoRef}
          playsInline
          muted
          autoPlay
          className="w-full h-full object-cover mirror-video"
        />

        {!cameraError && (
          <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
            <div className="w-48 h-60 rounded-[999px] border-4 border-primary/90 shadow-[0_0_0_9999px_rgba(15,23,42,0.45)]" />
          </div>
        )}

        {(initializing || saving) && !cameraError && (
          <div className="absolute inset-0 bg-slate-950/75 flex flex-col items-center justify-center text-white gap-2.5">
            <Loader2 className="w-8 h-8 animate-spin text-primary" />
            <span className="text-sm font-bold">{statusMessage}</span>
          </div>
        )}

        {cameraError && (
          <div className="absolute inset-0 bg-slate-900 flex flex-col items-center justify-center text-white gap-3 p-6 text-center">
            <Camera className="w-8 h-8 text-red-400" />
            <p className="text-sm">{cameraError}</p>
            <button
              type="button"
              onClick={() => setRetryCounter((c) => c + 1)}
              className="inline-flex items-center gap-2 rounded-xl bg-primary-600 px-4 py-2 text-xs font-bold"
            >
              <RefreshCw className="w-4 h-4" />
              Coba Lagi
            </button>
          </div>
        )}

        {!initializing && !saving && !cameraError && (
          <div className="absolute bottom-4 inset-x-4 flex justify-center">
            <div className="rounded-xl bg-slate-900/80 border border-white/20 px-4 py-2 text-sm font-bold text-white backdrop-blur">
              Sampel {Math.min(stepIndex + 1, 5)}/5: {statusMessage}
            </div>
          </div>
        )}
      </div>

      <div className="flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={() => {
            stopCamera();
            onCancel();
          }}
          disabled={saving}
          className="rounded-xl border border-border-sky bg-white hover:bg-page px-4 py-2.5 text-sm font-semibold text-ink"
        >
          Batal
        </button>

        {!initializing && !saving && !cameraError && stepIndex < ENROLLMENT_STEPS.length && (
          <button
            type="button"
            onClick={captureCurrentStep}
            className="inline-flex items-center gap-2 rounded-xl bg-primary-600 hover:bg-primary-700 text-white px-4 py-2.5 text-sm font-semibold transition"
          >
            <CheckCircle2 className="w-4 h-4" />
            <span>Ambil Sampel Manual ({stepIndex + 1}/5)</span>
          </button>
        )}
      </div>
    </div>
  );
}

