'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  ArrowLeft,
  CheckCircle2,
  KeyRound,
  Loader2,
  ScanFace,
  Shield,
  Users,
} from 'lucide-react';
import { toast } from 'sonner';
import type { SubjectType } from '@/types/database';
import { DynamicFaceEnrollView } from '@/components/face/DynamicFaceWidgets';
import { AutocompleteInput } from '@/components/ui/AutocompleteInput';
import { Modal } from '@/components/ui/Modal';

interface SubjectOption {
  id: string;
  subject_type: SubjectType;
  name: string;
  subtitle: string;
  code: string;
  sample_count: number;
}

export default function TabletDaftarWajahPage() {
  const [subjectType, setSubjectType] = useState<SubjectType>('employee');
  const [subjects, setSubjects] = useState<SubjectOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState('');
  const [pin, setPin] = useState('');
  const [pinVerified, setPinVerified] = useState(false);
  const [verifyingPin, setVerifyingPin] = useState(false);
  const [pinModalOpen, setPinModalOpen] = useState(false);
  const [captureActive, setCaptureActive] = useState(false);
  const [successInfo, setSuccessInfo] = useState<{ name: string; count: number } | null>(null);

  const loadSubjects = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/face/templates?subject_type=all', { cache: 'no-store' });
      const json = (await res.json()) as { subjects?: SubjectOption[]; error?: string };
      if (!res.ok) {
        toast.error(json.error ?? 'Gagal memuat daftar karyawan & pengawal.');
        return;
      }
      setSubjects(json.subjects ?? []);
    } catch {
      toast.error('Gagal terhubung ke server.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadSubjects();
  }, [loadSubjects]);

  const filteredSubjects = useMemo(
    () => subjects.filter((s) => s.subject_type === subjectType),
    [subjects, subjectType]
  );

  const selectedSubject = useMemo(
    () => filteredSubjects.find((s) => s.id === selectedId) ?? null,
    [filteredSubjects, selectedId]
  );

  const dropdownOptions = useMemo(
    () =>
      filteredSubjects.map((s) => ({
        value: s.id,
        label: s.name,
        sublabel: `${s.subtitle}${s.sample_count > 0 ? ` • Sudah terdaftar (${s.sample_count} sampel)` : ' • Belum terdaftar'}`,
      })),
    [filteredSubjects]
  );

  const handleStartEnroll = () => {
    if (!selectedSubject) {
      toast.error('Pilih nama terlebih dahulu.');
      return;
    }
    if (pinVerified && pin) {
      setCaptureActive(true);
    } else {
      setPinModalOpen(true);
    }
  };

  const handleVerifyPin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pin.trim()) {
      toast.error('Masukkan PIN admin terlebih dahulu.');
      return;
    }
    setVerifyingPin(true);
    try {
      const res = await fetch('/api/face/verify-pin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin: pin.trim() }),
      });
      const json = (await res.json()) as { valid?: boolean; error?: string };
      if (!res.ok || !json.valid) {
        toast.error(json.error ?? 'PIN admin tidak sesuai.');
        return;
      }
      setPinVerified(true);
      setPinModalOpen(false);
      setCaptureActive(true);
    } catch {
      toast.error('Gagal memverifikasi PIN.');
    } finally {
      setVerifyingPin(false);
    }
  };

  return (
    <div className="flex-1 px-6 lg:px-10 py-6 max-w-5xl w-full mx-auto space-y-6">
      <div className="flex items-center justify-between gap-4">
        <Link
          href="/absen"
          className="inline-flex items-center gap-2 rounded-2xl border border-border-sky bg-white hover:bg-page px-4 py-3 text-sm font-bold text-ink shadow-sm transition min-h-[48px]"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Kembali ke Beranda</span>
        </Link>
        <div className="text-right">
          <h1 className="text-xl lg:text-2xl font-extrabold text-ink">Pendaftaran Wajah</h1>
          <p className="text-xs text-ink-muted">Dilindungi PIN Admin untuk keamanan identitas</p>
        </div>
      </div>

      {!captureActive ? (
        <div className="rounded-2xl bg-surface border-2 border-border-sky shadow-card p-6 lg:p-8 space-y-6">
          <div>
            <label className="block text-sm font-bold text-ink mb-2">1. Pilih Kategori</label>
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => {
                  setSubjectType('employee');
                  setSelectedId('');
                }}
                className={`rounded-2xl border-2 p-4 flex items-center justify-center gap-3 text-base font-bold transition min-h-[64px] ${
                  subjectType === 'employee'
                    ? 'border-primary-600 bg-primary-50 text-primary-700'
                    : 'border-border-sky bg-white text-ink-muted hover:text-ink'
                }`}
              >
                <Users className="w-5 h-5" />
                <span>Karyawan</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setSubjectType('escort');
                  setSelectedId('');
                }}
                className={`rounded-2xl border-2 p-4 flex items-center justify-center gap-3 text-base font-bold transition min-h-[64px] ${
                  subjectType === 'escort'
                    ? 'border-primary-600 bg-primary-50 text-primary-700'
                    : 'border-border-sky bg-white text-ink-muted hover:text-ink'
                }`}
              >
                <Shield className="w-5 h-5" />
                <span>Pengawal</span>
              </button>
            </div>
          </div>

          <div>
            <label className="block text-sm font-bold text-ink mb-2">
              2. Cari & Pilih Nama {subjectType === 'employee' ? 'Karyawan' : 'Pengawal'}
            </label>
            {loading ? (
              <div className="flex items-center gap-2 text-sm text-ink-muted py-3">
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Memuat daftar...</span>
              </div>
            ) : (
              <AutocompleteInput
                options={dropdownOptions}
                value={selectedSubject?.name ?? ''}
                onChange={(val, opt) => {
                  if (opt) setSelectedId(opt.value);
                  else if (!val) setSelectedId('');
                }}
                placeholder={`Ketik nama ${subjectType === 'employee' ? 'karyawan' : 'pengawal'}...`}
              />
            )}
          </div>

          {selectedSubject && (
            <div className="rounded-2xl bg-page border border-border-sky p-4 flex flex-wrap items-center justify-between gap-4">
              <div>
                <div className="text-base font-extrabold text-ink">{selectedSubject.name}</div>
                <div className="text-sm text-ink-muted">{selectedSubject.subtitle}</div>
              </div>
              {selectedSubject.sample_count > 0 ? (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-100 text-emerald-800 px-3.5 py-1.5 text-xs font-bold">
                  <CheckCircle2 className="w-4 h-4" />
                  Sudah terdaftar ({selectedSubject.sample_count} sampel) — Mode Tambah Sampel
                </span>
              ) : (
                <span className="inline-flex rounded-full bg-amber-100 text-amber-800 px-3.5 py-1.5 text-xs font-bold">
                  Belum terdaftar
                </span>
              )}
            </div>
          )}

          <div className="pt-2 flex justify-end">
            <button
              type="button"
              disabled={!selectedSubject}
              onClick={handleStartEnroll}
              className="inline-flex items-center gap-2.5 rounded-2xl bg-primary-600 hover:bg-primary-700 disabled:opacity-50 text-white px-7 py-4 text-base font-bold shadow-soft transition min-h-[64px]"
            >
              <ScanFace className="w-6 h-6" />
              <span>
                {selectedSubject && selectedSubject.sample_count > 0
                  ? 'Tambah Sampel Wajah (3 Sampel)'
                  : 'Mulai Pendaftaran Wajah'}
              </span>
            </button>
          </div>
        </div>
      ) : (
        selectedSubject && (
          <div className="rounded-2xl bg-surface border-2 border-border-sky shadow-card p-6">
            <DynamicFaceEnrollView
              subjectType={subjectType}
              subjectId={selectedSubject.id}
              subjectName={selectedSubject.name}
              pin={pin}
              onCancel={() => setCaptureActive(false)}
              onSuccess={(inserted) => {
                setCaptureActive(false);
                setSuccessInfo({ name: selectedSubject.name, count: inserted });
                loadSubjects();
              }}
            />
          </div>
        )
      )}

      {/* Modal PIN Admin */}
      <Modal
        open={pinModalOpen}
        onClose={() => setPinModalOpen(false)}
        title="Verifikasi PIN Admin"
        description="Masukkan PIN admin pos security sebelum menyimpan data wajah."
        maxWidthClass="max-w-sm"
      >
        <form onSubmit={handleVerifyPin} className="space-y-4">
          <div className="relative">
            <KeyRound className="w-4 h-4 text-ink-muted absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="password"
              inputMode="numeric"
              autoFocus
              value={pin}
              onChange={(e) => setPin(e.target.value)}
              placeholder="Masukkan PIN admin"
              className="w-full rounded-xl border border-border-sky pl-10 pr-4 py-3 text-base tracking-widest focus:border-primary-600 focus:outline-none"
            />
          </div>
          <div className="flex justify-end gap-2.5">
            <button
              type="button"
              onClick={() => setPinModalOpen(false)}
              className="rounded-xl border border-border-sky px-4 py-2.5 text-sm font-semibold"
            >
              Batal
            </button>
            <button
              type="submit"
              disabled={verifyingPin}
              className="rounded-xl bg-primary-600 hover:bg-primary-700 text-white px-5 py-2.5 text-sm font-bold flex items-center gap-2"
            >
              {verifyingPin && <Loader2 className="w-4 h-4 animate-spin" />}
              <span>Verifikasi & Mulai</span>
            </button>
          </div>
        </form>
      </Modal>

      {/* Success Pop-up */}
      <Modal
        open={Boolean(successInfo)}
        onClose={() => setSuccessInfo(null)}
        title="Wajah Berhasil Didaftarkan"
        maxWidthClass="max-w-md"
      >
        <div className="text-center space-y-4">
          <div className="w-16 h-16 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center mx-auto">
            <CheckCircle2 className="w-10 h-10" />
          </div>
          <div>
            <p className="text-lg font-extrabold text-ink">{successInfo?.name}</p>
            <p className="text-sm text-ink-muted mt-1">
              {successInfo?.count ?? 5} sampel wajah berhasil disimpan dan siap dipakai untuk absensi.
            </p>
          </div>
          <div className="flex flex-col sm:flex-row gap-2.5 pt-2">
            <button
              type="button"
              onClick={() => {
                setSuccessInfo(null);
                setSelectedId('');
              }}
              className="flex-1 rounded-xl border border-border-sky px-4 py-3 text-sm font-bold text-ink hover:bg-page"
            >
              Daftar Orang Lain
            </button>
            <Link
              href="/absen"
              className="flex-1 rounded-xl bg-primary-600 hover:bg-primary-700 text-white px-4 py-3 text-sm font-bold text-center"
            >
              Ke Beranda Absen
            </Link>
          </div>
        </div>
      </Modal>
    </div>
  );
}

