'use client';

import { use, useCallback, useState } from 'react';
import Link from 'next/link';
import { notFound, useRouter } from 'next/navigation';
import { ArrowLeft, Loader2 } from 'lucide-react';
import type { AttendanceEventType } from '@/types/database';
import type { FaceMatchSuccess } from '@/lib/face';
import { DynamicFaceScanner } from '@/components/face/DynamicFaceWidgets';
import {
  AttendanceSuccessModal,
  AttendanceWarningModal,
} from '@/components/absen/AttendanceSuccessModal';

const MODE_LABELS: Record<AttendanceEventType, { title: string; subtitle: string }> = {
  masuk: {
    title: 'Absen MASUK',
    subtitle: 'Hadapkan wajah ke kamera untuk mencatat jam kedatangan Anda.',
  },
  istirahat: {
    title: 'Absen ISTIRAHAT',
    subtitle: 'Hadapkan wajah ke kamera untuk mencatat jam mulai istirahat.',
  },
  pulang: {
    title: 'Absen PULANG',
    subtitle: 'Hadapkan wajah ke kamera untuk mencatat jam pulang kerja.',
  },
};

function isValidMode(v: string): v is AttendanceEventType {
  return v === 'masuk' || v === 'istirahat' || v === 'pulang';
}

export default function AbsenModePage({
  params,
}: {
  params: Promise<{ mode: string }>;
}) {
  const { mode } = use(params);
  const router = useRouter();

  if (!isValidMode(mode)) {
    notFound();
  }

  const meta = MODE_LABELS[mode];
  const [submitting, setSubmitting] = useState(false);
  const [recognizedName, setRecognizedName] = useState<string | null>(null);
  const [successData, setSuccessData] = useState<{
    name: string;
    position: string;
    dateLabel: string;
    timeLabel: string;
  } | null>(null);
  const [warningData, setWarningData] = useState<{
    title: string;
    message: string;
    employeeName?: string;
  } | null>(null);

  const handleFaceMatched = useCallback(
    async (match: FaceMatchSuccess) => {
      if (submitting || successData || warningData) return;
      setSubmitting(true);
      setRecognizedName(match.name);
      try {
        const res = await fetch('/api/absen', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            employee_id: match.subject_id,
            mode,
            match_distance: match.distance,
          }),
        });
        const json = (await res.json()) as {
          success?: boolean;
          duplicate?: boolean;
          error?: string;
          employeeName?: string;
          employee?: { name: string; position: string };
          formattedDate?: string;
          formattedTime?: string;
        };

        if (!res.ok) {
          setWarningData({
            title: json.duplicate ? 'Absen Sudah Tercatat' : 'Absen Tidak Dapat Diproses',
            message: json.error ?? 'Gagal mencatat absensi.',
            employeeName: json.employeeName ?? match.name,
          });
          return;
        }

        setSuccessData({
          name: json.employee?.name ?? match.name,
          position: json.employee?.position ?? match.subtitle,
          dateLabel: json.formattedDate ?? '',
          timeLabel: json.formattedTime ?? '',
        });
      } catch {
        setWarningData({
          title: 'Gangguan Koneksi',
          message: 'Gagal mengirim data absen ke server. Coba scan ulang.',
          employeeName: match.name,
        });
      } finally {
        setSubmitting(false);
        setRecognizedName(null);
      }
    },
    [mode, submitting, successData, warningData]
  );

  const handleDone = useCallback(() => {
    setSuccessData(null);
    router.push('/absen');
  }, [router]);

  return (
    <div className="flex-1 px-4 sm:px-6 lg:px-10 py-4 max-w-2xl w-full mx-auto flex flex-col gap-3 justify-center">
      <div className="flex items-center justify-between gap-3">
        <Link
          href="/absen"
          className="inline-flex items-center gap-2 rounded-2xl border border-border-sky bg-white hover:bg-page px-4 py-2.5 text-sm font-bold text-ink shadow-sm transition min-h-[44px]"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Kembali</span>
        </Link>
        {submitting && (
          <div className="inline-flex items-center gap-2 rounded-xl bg-primary-100 text-primary-700 px-3.5 py-2 text-xs sm:text-sm font-bold">
            <Loader2 className="w-4 h-4 animate-spin shrink-0" />
            <span>
              {recognizedName ? `Terdeteksi ${recognizedName} — menyimpan...` : 'Menyimpan absensi...'}
            </span>
          </div>
        )}
      </div>

      <DynamicFaceScanner
        purpose="employee"
        title={meta.title}
        subtitle={meta.subtitle}
        paused={Boolean(successData || warningData || submitting)}
        onResult={handleFaceMatched}
        onCancel={() => router.push('/absen')}
      />

      <AttendanceSuccessModal
        open={Boolean(successData)}
        title="Absen Berhasil"
        subtitle={`${meta.title} — ${successData?.position ?? ''}`}
        name={successData?.name ?? ''}
        dateLabel={successData?.dateLabel ?? ''}
        timeLabel={successData?.timeLabel ?? ''}
        onClose={handleDone}
      />

      <AttendanceWarningModal
        open={Boolean(warningData)}
        title={warningData?.title ?? 'Perhatian'}
        message={warningData?.message ?? ''}
        employeeName={warningData?.employeeName}
        onClose={() => {
          setWarningData(null);
          router.push('/absen');
        }}
      />
    </div>
  );
}

