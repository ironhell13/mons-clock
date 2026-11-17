'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  Camera,
  Loader2,
  RefreshCw,
  ShieldCheck,
  Zap,
} from 'lucide-react';
import { toast } from 'sonner';
import type { SubjectType } from '@/types/database';
import { FACE_CONFIG } from '@/lib/face-config';
import {
  ensureFaceModelsLoaded,
  extractFaceDescriptor,
  playBeep,
} from '@/lib/face';
import {
  analyzeMediaPipeResult,
  capturePortraitSampleCanvas,
  getFaceLandmarker,
  type NormalizedFaceBox,
  type CropQualityMetrics,
} from '@/lib/mediapipe';
import {
  checkInternalConsistency,
} from '@/lib/face-decision';

interface EnrollmentStep {
  key: string;
  label: string;
  instruction: string;
  checkPose: (yaw: number, pitchDelta: number) => boolean;
}

const ENROLLMENT_STEPS: EnrollmentStep[] = [
  {
    key: 'lurus',
    label: 'Hadap Kamera',
    instruction: 'Posisikan wajah di dalam oval dan hadap ke kamera',
    checkPose: (yaw, pitchDelta) => Math.abs(yaw) <= 0.18 && Math.abs(pitchDelta) <= 0.18,
  },
  {
    key: 'rileks',
    label: 'Tahan Posisi',
    instruction: 'Tahan posisi dengan santai dan rileks...',
    checkPose: (yaw, pitchDelta) => Math.abs(yaw) <= 0.18 && Math.abs(pitchDelta) <= 0.18,
  },
  {
    key: 'verifikasi',
    label: 'Verifikasi',
    instruction: 'Satu detik lagi, hampir selesai...',
    checkPose: (yaw, pitchDelta) => Math.abs(yaw) <= 0.18 && Math.abs(pitchDelta) <= 0.18,
  },
];

interface FrameBufferItem {
  descriptor: number[];
  metrics?: CropQualityMetrics;
}

interface EnrolledSample {
  descriptor: number[];
  sample_label: string;
  quality?: Record<string, unknown>;
}

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
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const capturingRef = useRef<boolean>(false);
  const stepIndexRef = useRef<number>(0);
  const samplesRef = useRef<EnrolledSample[]>([]);
  const currentStepFramesRef = useRef<FrameBufferItem[]>([]);
  const lastCaptureAtRef = useRef<number>(0);
  const lastBoxRef = useRef<NormalizedFaceBox | null>(null);
  const pitchFrontalRef = useRef<number>(0);
  const pitchCalibratedRef = useRef<boolean>(false);

  const [cameraReady, setCameraReady] = useState(false);
  const [modelsReady, setModelsReady] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [stepIndex, setStepIndex] = useState(0);
  const [subFrameCount, setSubFrameCount] = useState(0);
  const [statusMessage, setStatusMessage] = useState('Menyalakan kamera...');
  const [saving, setSaving] = useState(false);
  const [duplicateWarning, setDuplicateWarning] = useState<string | null>(null);
  const [retryCounter, setRetryCounter] = useState(0);

  // Efek Flash Layar untuk pencahayaan instan
  const [isFlashing, setIsFlashing] = useState(false);

  const stopCamera = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
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
    async (collected: EnrolledSample[]) => {
      setSaving(true);
      setStatusMessage('Memeriksa konsistensi sampel & menyimpan...');

      // 1. Cek konsistensi internal: jarak sampel ke centroid <= ENROLL_MAX_OUTLIER_DIST
      const consistency = checkInternalConsistency(collected, FACE_CONFIG.ENROLL_MAX_OUTLIER_DIST);
      if (!consistency.ok) {
        const worstIdx = consistency.outlierIndices[0] ?? 0;
        const outlierStep = ENROLLMENT_STEPS[worstIdx] ?? ENROLLMENT_STEPS[0];
        toast.warning(
          `Sampel "${outlierStep.label}" kurang konsisten dengan sampel lainnya. Mengulang pengambilan sampel.`
        );
        // Hapus sampel outlier dan kembali ke step tersebut
        const remaining = collected.filter((_, idx) => idx !== worstIdx);
        samplesRef.current = remaining;
        stepIndexRef.current = worstIdx;
        setStepIndex(worstIdx);
        currentStepFramesRef.current = [];
        setSubFrameCount(0);
        setSaving(false);
        setStatusMessage(outlierStep.instruction);
        return;
      }

      // 2. Kirim ke /api/face/enroll
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

        const json = (await res.json()) as {
          inserted?: number;
          error?: string;
          similar_subject?: { name: string; score: number };
        };

        if (!res.ok) {
          const errText = json.error ?? 'Gagal menyimpan pendaftaran wajah.';
          toast.error(errText);
          setDuplicateWarning(errText);
          setSaving(false);
          return;
        }

        playBeep(1174, 200); // Nada sukses
        toast.success(`Berhasil mendaftarkan ${collected.length} sampel wajah untuk ${subjectName}.`);
        stopCamera();
        onSuccess(json.inserted ?? collected.length);
      } catch {
        toast.error('Terjadi kesalahan jaringan saat menyimpan pendaftaran.');
        setSaving(false);
      }
    },
    [onSuccess, pin, stopCamera, subjectId, subjectName, subjectType]
  );

  const captureCurrentStep = useCallback(
    async (force = false) => {
      const video = videoRef.current;
      if (!video || capturingRef.current || saving || !lastBoxRef.current) return;

      capturingRef.current = true;
      setIsFlashing(true);
      setStatusMessage('Mengambil foto wajah...');

      // Jeda 120ms agar pancaran cahaya layar menyinari wajah secara merata
      await new Promise((resolve) => setTimeout(resolve, 120));

      try {
        const ext = await extractFaceDescriptor(video, lastBoxRef.current);
        setIsFlashing(false);

        if (!ext.descriptor) {
          setStatusMessage(ext.reason ?? 'Posisikan wajah lebih jelas & stabil.');
          return;
        }

        playBeep(880, 80);

        const frames = [
          ...currentStepFramesRef.current,
          { descriptor: ext.descriptor, metrics: ext.metrics },
        ];
        currentStepFramesRef.current = frames;
        setSubFrameCount(frames.length);

        // Jika belum mencapai ENROLL_FRAMES_PER_SAMPLE (1 frame) dan bukan klik manual
        if (!force && frames.length < FACE_CONFIG.ENROLL_FRAMES_PER_SAMPLE) {
          setStatusMessage(`Tahan posisi... (${frames.length}/${FACE_CONFIG.ENROLL_FRAMES_PER_SAMPLE})`);
          lastCaptureAtRef.current = Date.now();
          return;
        }

        // Rata-ratakan frame yang terkumpul untuk step ini
        const dim = ext.descriptor.length;
        const avgDesc = new Array<number>(dim).fill(0);
        for (const f of frames) {
          for (let i = 0; i < dim; i++) {
            avgDesc[i] += f.descriptor[i];
          }
        }
        for (let i = 0; i < dim; i++) {
          avgDesc[i] /= frames.length;
        }

        // Rata-ratakan metrik kualitas
        const avgQuality = {
          brightness: Math.round(
            frames.reduce((acc, f) => acc + (f.metrics?.brightness ?? 120), 0) / frames.length
          ),
          lrRatio: Number(
            (frames.reduce((acc, f) => acc + (f.metrics?.lrRatio ?? 1), 0) / frames.length).toFixed(2)
          ),
          sharpness: Math.round(
            frames.reduce((acc, f) => acc + (f.metrics?.sharpness ?? 80), 0) / frames.length
          ),
          clippedPct: Number(
            (frames.reduce((acc, f) => acc + (f.metrics?.clippedPct ?? 0), 0) / frames.length).toFixed(1)
          ),
        };

        const currentStep = ENROLLMENT_STEPS[stepIndexRef.current];
        const newSample: EnrolledSample = {
          descriptor: avgDesc,
          sample_label: currentStep?.key ?? `sample_${stepIndexRef.current + 1}`,
          quality: avgQuality,
        };

        const nextSamples = [...samplesRef.current, newSample];
        samplesRef.current = nextSamples;
        currentStepFramesRef.current = [];
        setSubFrameCount(0);
        lastCaptureAtRef.current = Date.now();

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
        setIsFlashing(false);
        capturingRef.current = false;
      }
    },
    [saving, submitSamples]
  );

  useEffect(() => {
    let cancelled = false;

    async function setup() {
      setCameraReady(false);
      setModelsReady(false);
      setCameraError(null);
      setDuplicateWarning(null);
      samplesRef.current = [];
      currentStepFramesRef.current = [];
      stepIndexRef.current = 0;
      setStepIndex(0);
      setSubFrameCount(0);
      pitchCalibratedRef.current = false;

      try {
        const streamPromise = navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: 'user',
            width: { ideal: 720 },
            height: { ideal: 960 },
            frameRate: { ideal: 24, max: 30 },
          },
          audio: false,
        });

        const modelsPromise = Promise.all([
          getFaceLandmarker(),
          ensureFaceModelsLoaded(),
        ]);

        const stream = await streamPromise;
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }

        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }
        setCameraReady(true);
        setStatusMessage('Menyiapkan deteksi wajah...');

        await modelsPromise;
        if (cancelled) return;

        setModelsReady(true);
        setStatusMessage(ENROLLMENT_STEPS[0].instruction);
      } catch {
        if (cancelled) return;
        stopCamera();
        setCameraReady(false);
        setModelsReady(false);
        setCameraError('Tidak dapat mengakses kamera atau memuat model wajah.');
      }
    }

    setup();

    return () => {
      cancelled = true;
      stopCamera();
    };
  }, [retryCounter, stopCamera]);

  useEffect(() => {
    if (!cameraReady || !modelsReady || cameraError || saving || duplicateWarning) return;
    let active = true;

    const scheduleNext = (ms: number) => {
      if (!active) return;
      timerRef.current = setTimeout(runStep, ms);
    };

    const runStep = async () => {
      if (!active) return;
      if (document.hidden || capturingRef.current || Date.now() - lastCaptureAtRef.current < 450) {
        scheduleNext(120);
        return;
      }

      const video = videoRef.current;
      if (!video || video.readyState < 2 || !video.videoWidth) {
        scheduleNext(150);
        return;
      }

      const idx = stepIndexRef.current;
      if (idx >= ENROLLMENT_STEPS.length) return;
      const step = ENROLLMENT_STEPS[idx];

      try {
        const sampleCanvas = capturePortraitSampleCanvas(video);
        if (!sampleCanvas) {
          scheduleNext(150);
          return;
        }

        const landmarker = await getFaceLandmarker();
        const mpRes = landmarker.detectForVideo(sampleCanvas, performance.now());
        const analysis = analyzeMediaPipeResult(mpRes, video, pitchFrontalRef.current, {
          maxYaw: 0.20,
          maxPitchDelta: 0.20,
        });
        lastBoxRef.current = analysis.box;

        if (!analysis.statusOk) {
          setStatusMessage(analysis.message);
          scheduleNext(160);
          return;
        }

        // Kalibrasi pitch frontal otomatis saat step lurus (step 0)
        if (idx === 0 && !pitchCalibratedRef.current && Math.abs(analysis.yaw) < 0.10) {
          pitchFrontalRef.current = analysis.pitch;
          pitchCalibratedRef.current = true;
        }

        const pitchDelta = analysis.pitch - pitchFrontalRef.current;

        // Validasi pose kepala sesuai step saat ini
        if (!step.checkPose(analysis.yaw, pitchDelta)) {
          setStatusMessage(step.instruction);
          scheduleNext(160);
          return;
        }

        await captureCurrentStep(false);
        scheduleNext(300);
      } catch {
        scheduleNext(200);
      }
    };

    scheduleNext(150);

    return () => {
      active = false;
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [cameraError, cameraReady, captureCurrentStep, duplicateWarning, modelsReady, saving]);

  return (
    <div className="space-y-4">
      {/* Flash Screen Overlay (Aktif sesaat saat mengambil sampel untuk pencahayaan maksimal) */}
      <div
        className={`fixed inset-0 pointer-events-none z-50 transition-opacity duration-150 ease-out flex items-center justify-center ${
          isFlashing ? 'opacity-100 bg-white/95 backdrop-blur-[2px]' : 'opacity-0'
        }`}
        aria-hidden="true"
      >
        {isFlashing && (
          <div className="text-slate-800 text-sm font-black tracking-wider uppercase bg-white/90 px-5 py-2.5 rounded-full shadow-2xl border border-slate-200 animate-pulse">
            ⚡ Mengambil Sampel {stepIndex + 1}/3...
          </div>
        )}
      </div>

      {/* Banner Panduan */}
      <div className="rounded-xl bg-primary-50 border border-border-sky px-4 py-2.5 flex items-start gap-2.5">
        <ShieldCheck className="w-5 h-5 text-primary-700 shrink-0 mt-0.5" />
        <div className="text-xs text-ink-muted leading-relaxed">
          Pendaftaran wajah cepat berbantu flash layar untuk <strong className="text-ink">{subjectName}</strong> (3 sampel tampak depan).
          Cukup hadap kamera dengan santai. Foto wajah <strong>tidak disimpan</strong>.
        </div>
      </div>

      {/* Indikator 3 Sampel */}
      <div className="grid grid-cols-3 gap-2 max-w-md mx-auto">
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
                    ? 'bg-primary-100 border-primary-500 text-primary-700 font-bold shadow-sm'
                    : 'bg-page border-border-sky text-ink-muted'
              }`}
            >
              <div className="text-xs font-bold truncate">
                {done ? '✓' : `${idx + 1}`} {step.label}
              </div>
            </div>
          );
        })}
      </div>

      {/* Peringatan Kemiripan Wajah / Duplikat */}
      {duplicateWarning && (
        <div className="rounded-xl bg-danger/10 border border-danger/30 px-4 py-3 flex items-start gap-2.5 text-sm text-danger">
          <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="font-semibold">{duplicateWarning}</p>
            <div className="flex items-center gap-2 mt-2">
              <button
                type="button"
                onClick={() => setRetryCounter((c) => c + 1)}
                className="rounded-lg bg-danger text-white px-3 py-1.5 text-xs font-bold"
              >
                Ulangi Pendaftaran
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Preview Kamera Portrait 3:4 */}
      <div
        onClick={() => {
          if (cameraReady && modelsReady && !saving && !cameraError && stepIndex < ENROLLMENT_STEPS.length) {
            captureCurrentStep(true);
          }
        }}
        className="relative bg-slate-950 rounded-2xl overflow-hidden aspect-[3/4] max-w-[360px] max-h-[54vh] w-full mx-auto flex items-center justify-center cursor-pointer select-none"
        title="Klik kamera untuk mengambil foto instan (Flash)"
      >
        <video
          ref={videoRef}
          playsInline
          muted
          autoPlay
          className="w-full h-full object-cover mirror-video"
        />

        {!cameraError && (
          <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
            <div className="w-[66%] h-[64%] rounded-[999px] border-[3px] border-primary/90" />
          </div>
        )}

        {(!cameraReady || saving) && !cameraError && (
          <div className="absolute inset-0 bg-slate-950/85 flex flex-col items-center justify-center text-white gap-2.5">
            <Loader2 className="w-8 h-8 animate-spin text-primary" />
            <span className="text-sm font-bold text-center px-4">{statusMessage}</span>
          </div>
        )}

        {cameraError && (
          <div className="absolute inset-0 bg-slate-900 flex flex-col items-center justify-center text-white gap-3 p-6 text-center">
            <Camera className="w-8 h-8 text-red-400" />
            <p className="text-sm">{cameraError}</p>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setRetryCounter((c) => c + 1);
              }}
              className="inline-flex items-center gap-2 rounded-xl bg-primary-600 px-4 py-2 text-xs font-bold"
            >
              <RefreshCw className="w-4 h-4" />
              Coba Lagi
            </button>
          </div>
        )}

        {cameraReady && !saving && !cameraError && (
          <div className="absolute bottom-3 inset-x-3 flex flex-col items-center gap-1.5 pointer-events-none">
            {subFrameCount > 0 && subFrameCount < FACE_CONFIG.ENROLL_FRAMES_PER_SAMPLE && (
              <div className="inline-flex items-center gap-1.5 rounded-full bg-primary-600/90 text-white text-[11px] font-bold px-3 py-0.5">
                <span>Merekam frame {subFrameCount}/{FACE_CONFIG.ENROLL_FRAMES_PER_SAMPLE}</span>
              </div>
            )}
            <div className="inline-flex items-center gap-2 rounded-xl bg-slate-900/90 border border-white/20 px-3.5 py-2 text-xs sm:text-sm font-bold text-white max-w-[92%] text-center">
              {!modelsReady && <Loader2 className="w-4 h-4 animate-spin shrink-0" />}
              <span>
                {modelsReady
                  ? `Sampel ${Math.min(stepIndex + 1, ENROLLMENT_STEPS.length)}/${ENROLLMENT_STEPS.length}: ${statusMessage}`
                  : statusMessage}
              </span>
            </div>
          </div>
        )}
      </div>

      {/* Tombol Aksi */}
      <div className="flex items-center justify-between gap-3 max-w-md mx-auto">
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

        {cameraReady && modelsReady && !saving && !cameraError && stepIndex < ENROLLMENT_STEPS.length && (
          <button
            type="button"
            onClick={() => captureCurrentStep(true)}
            className="inline-flex items-center gap-2 rounded-xl bg-primary-600 hover:bg-primary-700 active:scale-95 text-white px-5 py-2.5 text-sm font-bold shadow-md transition"
          >
            <Zap className="w-4 h-4 text-amber-300" />
            <span>Ambil Foto (Flash) ({stepIndex + 1}/{ENROLLMENT_STEPS.length})</span>
          </button>
        )}
      </div>
    </div>
  );
}
