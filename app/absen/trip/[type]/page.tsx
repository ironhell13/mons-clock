'use client';

import { use, useCallback, useMemo, useState } from 'react';
import Link from 'next/link';
import { notFound, useRouter } from 'next/navigation';
import {
  ArrowLeft,
  Car,
  CheckCircle2,
  Clock,
  Loader2,
  MapPin,
  Plus,
  RefreshCw,
  Shield,
  Trash2,
  UserCheck,
  Users,
} from 'lucide-react';
import { toast } from 'sonner';
import type { TripType } from '@/types/database';
import type { FaceMatchSuccess } from '@/lib/face';
import { DynamicFaceScanner } from '@/components/face/DynamicFaceWidgets';
import { AutocompleteInput } from '@/components/ui/AutocompleteInput';
import { Modal } from '@/components/ui/Modal';
import { AttendanceSuccessModal } from '@/components/absen/AttendanceSuccessModal';

interface OpenTripItem {
  id: string;
  trip_type: TripType;
  depart_at: string;
  plate: string;
  km_start: number;
  run_code: string | null;
  departFormattedDate: string;
  departFormattedTime: string;
  estimatedDurationHHMM: string;
  staff1: { id: string; name: string; position: string } | null;
  staff2: { id: string; name: string; position: string } | null;
  escort: { id: string; name: string; vendor: string } | null;
  area: { id: string; name: string } | null;
}

interface TripContextResponse {
  employee: { id: string; name: string; position: string };
  serverNowIso: string;
  serverFormattedDate: string;
  serverFormattedTime: string;
  scanToken: string;
  openTrips: OpenTripItem[];
  plates: string[];
  areas: { id: string; name: string }[];
}

function parseTripType(raw: string): TripType | null {
  const upper = raw.toUpperCase();
  if (upper === 'FLM' || upper === 'RPL' || upper === 'CIT') return upper;
  return null;
}

export default function AbsenTripPage({
  params,
}: {
  params: Promise<{ type: string }>;
}) {
  const { type } = use(params);
  const router = useRouter();
  const tripType = parseTripType(type);

  if (!tripType) {
    notFound();
  }

  const [ctx, setCtx] = useState<TripContextResponse | null>(null);
  const [loadingCtx, setLoadingCtx] = useState(false);

  // Mode Kembali selection
  const [selectedOpenTrip, setSelectedOpenTrip] = useState<OpenTripItem | null>(null);
  const [kmEnd, setKmEnd] = useState('');

  // Mode Keluar fields
  const [staff2, setStaff2] = useState<{ id: string; name: string; position: string } | null>(null);
  const [escort, setEscort] = useState<{ id: string; name: string; vendor: string } | null>(null);
  const [plate, setPlate] = useState('');
  const [kmStart, setKmStart] = useState('');
  const [areaId, setAreaId] = useState('');
  const [areaLabel, setAreaLabel] = useState('');
  const [runCode, setRunCode] = useState('');

  // Secondary scanner modal ('staff2' | 'escort' | null)
  const [subScanMode, setSubScanMode] = useState<'staff2' | 'escort' | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [successModal, setSuccessModal] = useState<{
    title: string;
    subtitle: string;
    name: string;
    dateLabel: string;
    timeLabel: string;
    extraRows: { label: string; value: string }[];
  } | null>(null);

  const handleFirstScan = useCallback(
    async (match: FaceMatchSuccess) => {
      if (loadingCtx || ctx) return;
      setLoadingCtx(true);
      try {
        const res = await fetch(
          `/api/trips/context?trip_type=${tripType}&employee_id=${match.subject_id}`,
          { cache: 'no-store' }
        );
        const json = (await res.json()) as TripContextResponse & { error?: string };
        if (!res.ok) {
          toast.error(json.error ?? 'Gagal memuat status perjalanan.');
          setLoadingCtx(false);
          return;
        }
        setCtx(json);
        if (json.openTrips.length === 1) {
          setSelectedOpenTrip(json.openTrips[0]);
        }
      } catch {
        toast.error('Gagal terhubung ke server.');
      } finally {
        setLoadingCtx(false);
      }
    },
    [ctx, loadingCtx, tripType]
  );

  const plateOptions = useMemo(
    () => (ctx?.plates ?? []).map((p) => ({ value: p, label: p })),
    [ctx?.plates]
  );

  const areaOptions = useMemo(
    () => (ctx?.areas ?? []).map((a) => ({ value: a.id, label: a.name })),
    [ctx?.areas]
  );

  const handleSubScanResult = useCallback(
    (match: FaceMatchSuccess) => {
      if (subScanMode === 'staff2') {
        if (ctx && match.subject_id === ctx.employee.id) {
          toast.error('Staff 2 tidak boleh sama dengan Staff 1.');
          return;
        }
        setStaff2({
          id: match.subject_id,
          name: match.name,
          position: match.subtitle,
        });
        toast.success(`Staff 2 terpilih: ${match.name}`);
        setSubScanMode(null);
      } else if (subScanMode === 'escort') {
        setEscort({
          id: match.subject_id,
          name: match.name,
          vendor: match.subtitle,
        });
        toast.success(`Pengawal terpilih: ${match.name} (${match.subtitle})`);
        setSubScanMode(null);
      }
    },
    [ctx, subScanMode]
  );

  const handleSubmitDepart = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ctx) return;
    if (!plate.trim()) {
      toast.error('Nomor polisi wajib diisi.');
      return;
    }
    if (kmStart === '' || Number(kmStart) < 0) {
      toast.error('KM Awal wajib diisi dengan angka valid.');
      return;
    }
    if (tripType === 'FLM' && !areaId) {
      toast.error('Area FLM wajib dipilih dari daftar master.');
      return;
    }
    if (tripType !== 'FLM' && !runCode.trim()) {
      toast.error('Kode RUN wajib diisi.');
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch('/api/trips/depart', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          trip_type: tripType,
          staff1_id: ctx.employee.id,
          staff2_id: staff2?.id ?? null,
          escort_id: escort?.id ?? null,
          plate,
          km_start: Number(kmStart),
          area_id: tripType === 'FLM' ? areaId : null,
          run_code: tripType !== 'FLM' ? runCode.trim() : null,
          scanToken: ctx.scanToken,
        }),
      });
      const json = (await res.json()) as {
        error?: string;
        trip?: { plate: string };
        staff1Name?: string;
        formattedDate?: string;
        formattedTime?: string;
      };
      if (!res.ok) {
        toast.error(json.error ?? 'Gagal mencatat keberangkatan.');
        return;
      }

      setSuccessModal({
        title: `Berhasil Berangkat (${tripType})`,
        subtitle: 'Data keberangkatan armada telah dicatat.',
        name: json.staff1Name || ctx.employee.name,
        dateLabel: json.formattedDate || ctx.serverFormattedDate,
        timeLabel: json.formattedTime || ctx.serverFormattedTime,
        extraRows: [
          { label: 'Nopol', value: json.trip?.plate ?? plate.toUpperCase() },
          ...(tripType === 'FLM'
            ? [{ label: 'Area', value: areaLabel }]
            : [{ label: 'RUN', value: runCode.trim() }]),
        ],
      });
    } catch {
      toast.error('Gagal terhubung ke server.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleSubmitReturn = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ctx || !selectedOpenTrip) return;

    const kmNum = Number(kmEnd);
    if (kmEnd === '' || Number.isNaN(kmNum) || kmNum < selectedOpenTrip.km_start) {
      toast.error(`KM Akhir wajib diisi dan minimal ${selectedOpenTrip.km_start}.`);
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch('/api/trips/return', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          trip_id: selectedOpenTrip.id,
          scanned_employee_id: ctx.employee.id,
          km_end: kmNum,
          scanToken: ctx.scanToken,
        }),
      });
      const json = (await res.json()) as {
        error?: string;
        staffName?: string;
        formattedDate?: string;
        formattedTime?: string;
        durationHHMM?: string;
        totalKm?: number;
      };
      if (!res.ok) {
        toast.error(json.error ?? 'Gagal mencatat kepulangan.');
        return;
      }

      setSuccessModal({
        title: `Berhasil Kembali (${tripType})`,
        subtitle: 'Perjalanan armada telah selesai dan ditutup.',
        name: json.staffName || ctx.employee.name,
        dateLabel: json.formattedDate || ctx.serverFormattedDate,
        timeLabel: json.formattedTime || ctx.serverFormattedTime,
        extraRows: [
          { label: 'Nopol', value: selectedOpenTrip.plate },
          { label: 'Durasi', value: json.durationHHMM ?? selectedOpenTrip.estimatedDurationHHMM },
          {
            label: 'Total KM',
            value: `${(json.totalKm ?? kmNum - selectedOpenTrip.km_start).toLocaleString('id-ID')} km`,
          },
        ],
      });
    } catch {
      toast.error('Gagal terhubung ke server.');
    } finally {
      setSubmitting(false);
    }
  };

  const liveReturnTotalKm = useMemo(() => {
    if (!selectedOpenTrip || kmEnd === '') return null;
    const val = Number(kmEnd) - selectedOpenTrip.km_start;
    return Number.isNaN(val) || val < 0 ? null : val;
  }, [kmEnd, selectedOpenTrip]);

  return (
    <div className="flex-1 px-6 lg:px-10 py-5 max-w-5xl w-full mx-auto space-y-5">
      <div className="flex items-center justify-between gap-4">
        <Link
          href="/absen"
          className="inline-flex items-center gap-2 rounded-2xl border border-border-sky bg-white hover:bg-page px-4 py-3 text-sm font-bold text-ink shadow-sm transition min-h-[48px]"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Kembali</span>
        </Link>
        <div className="text-right">
          <span className="inline-flex rounded-xl bg-primary-100 text-primary-700 px-3.5 py-1 text-sm font-extrabold">
            Mutasi {tripType}
          </span>
        </div>
      </div>

      {/* Step 1: Initial Face Scan */}
      {!ctx && (
        <div className="space-y-3">
          {loadingCtx && (
            <div className="rounded-xl bg-primary-50 border border-border-sky px-4 py-3 flex items-center justify-center gap-2 text-sm font-bold text-primary-700">
              <Loader2 className="w-4 h-4 animate-spin" />
              <span>Memeriksa status perjalanan karyawan...</span>
            </div>
          )}
          <DynamicFaceScanner
            purpose="employee"
            title={`Scan Wajah — Mutasi ${tripType}`}
            subtitle="Sistem otomatis mendeteksi apakah Anda akan berangkat (Keluar) atau selesai tugas (Kembali)."
            paused={loadingCtx}
            onResult={handleFirstScan}
            onCancel={() => router.push('/absen')}
          />
        </div>
      )}

      {/* Step 2A: Mode KELUAR (tidak ada trip terbuka) */}
      {ctx && ctx.openTrips.length === 0 && (
        <form
          onSubmit={handleSubmitDepart}
          className="rounded-2xl bg-surface border-2 border-border-sky shadow-card p-6 lg:p-8 space-y-6"
        >
          <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-border-sky">
            <div>
              <span className="inline-flex rounded-lg bg-sky-100 text-sky-800 px-3 py-1 text-xs font-extrabold uppercase">
                Mode Keluar (Berangkat)
              </span>
              <h2 className="text-xl font-extrabold text-ink mt-1.5">
                Form Keberangkatan {tripType}
              </h2>
            </div>
            <div className="rounded-xl bg-page border border-border-sky px-4 py-2.5 text-right">
              <div className="text-[11px] font-semibold text-ink-muted">Jam Keluar Otomatis</div>
              <div className="text-sm font-extrabold text-primary-700 tabular-nums">
                {ctx.serverFormattedDate} • {ctx.serverFormattedTime}
              </div>
            </div>
          </div>

          {/* Baris 1: Staff 1 (terkunci) */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="rounded-2xl bg-primary-50 border-2 border-primary-200 p-4">
              <div className="text-xs font-bold text-primary-700 flex items-center gap-1.5">
                <UserCheck className="w-4 h-4" />
                <span>STAFF 1 (Terkunci)</span>
              </div>
              <div className="text-base font-extrabold text-ink mt-1">{ctx.employee.name}</div>
              <div className="text-xs text-ink-muted">{ctx.employee.position}</div>
            </div>

            {/* Staff 2 opsional */}
            <div className="rounded-2xl bg-page border border-border-sky p-4 flex flex-col justify-between">
              <div className="text-xs font-bold text-ink-muted flex items-center gap-1.5">
                <Users className="w-4 h-4" />
                <span>STAFF 2 (Opsional)</span>
              </div>
              {staff2 ? (
                <div className="mt-1 flex items-center justify-between gap-2">
                  <div>
                    <div className="text-sm font-extrabold text-ink">{staff2.name}</div>
                    <div className="text-xs text-ink-muted">{staff2.position}</div>
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => setSubScanMode('staff2')}
                      className="p-2 rounded-lg bg-white border border-border-sky text-primary-700 hover:bg-primary-50"
                      title="Ganti Staff 2"
                    >
                      <RefreshCw className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setStaff2(null)}
                      className="p-2 rounded-lg bg-white border border-border-sky text-danger hover:bg-danger/10"
                      title="Hapus Staff 2"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setSubScanMode('staff2')}
                  className="mt-2 w-full rounded-xl border-2 border-dashed border-primary-300 bg-white hover:bg-primary-50 py-3 text-sm font-bold text-primary-700 flex items-center justify-center gap-1.5 min-h-[48px]"
                >
                  <Plus className="w-4 h-4" />
                  <span>Staff 2</span>
                </button>
              )}
            </div>

            {/* Pengawal opsional */}
            <div className="rounded-2xl bg-page border border-border-sky p-4 flex flex-col justify-between">
              <div className="text-xs font-bold text-ink-muted flex items-center gap-1.5">
                <Shield className="w-4 h-4" />
                <span>PENGAWAL (Opsional)</span>
              </div>
              {escort ? (
                <div className="mt-1 flex items-center justify-between gap-2">
                  <div>
                    <div className="text-sm font-extrabold text-ink">{escort.name}</div>
                    <div className="text-xs font-bold text-primary-700">{escort.vendor}</div>
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => setSubScanMode('escort')}
                      className="p-2 rounded-lg bg-white border border-border-sky text-primary-700 hover:bg-primary-50"
                      title="Ganti Pengawal"
                    >
                      <RefreshCw className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setEscort(null)}
                      className="p-2 rounded-lg bg-white border border-border-sky text-danger hover:bg-danger/10"
                      title="Hapus Pengawal"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setSubScanMode('escort')}
                  className="mt-2 w-full rounded-xl border-2 border-dashed border-primary-300 bg-white hover:bg-primary-50 py-3 text-sm font-bold text-primary-700 flex items-center justify-center gap-1.5 min-h-[48px]"
                >
                  <Plus className="w-4 h-4" />
                  <span>Pengawal</span>
                </button>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-bold text-ink mb-1.5">Nomor Polisi (NOPOL) *</label>
              <AutocompleteInput
                options={plateOptions}
                value={plate}
                onChange={(val) => setPlate(val)}
                placeholder="Contoh: B 1549 SZV"
                allowFreeText
                uppercase
                badgeForFreeText="Nopol tidak ada di master"
              />
            </div>

            <div>
              <label className="block text-sm font-bold text-ink mb-1.5">KM Awal *</label>
              <input
                type="number"
                inputMode="numeric"
                min={0}
                value={kmStart}
                onChange={(e) => setKmStart(e.target.value)}
                placeholder="Masukkan KM odometer"
                className="w-full rounded-xl border border-border-sky bg-white px-4 py-3 text-sm font-bold text-ink focus:border-primary-600 focus:outline-none focus:ring-2 focus:ring-primary/25"
              />
            </div>

            {tripType === 'FLM' ? (
              <div>
                <label className="block text-sm font-bold text-ink mb-1.5">AREA (Master Area) *</label>
                <AutocompleteInput
                  options={areaOptions}
                  value={areaLabel}
                  onChange={(val, opt) => {
                    if (opt) {
                      setAreaId(opt.value);
                      setAreaLabel(opt.label);
                    } else {
                      setAreaId('');
                      setAreaLabel('');
                    }
                  }}
                  placeholder="Ketik & pilih area..."
                  allowFreeText={false}
                />
              </div>
            ) : (
              <div>
                <label className="block text-sm font-bold text-ink mb-1.5">Kode RUN *</label>
                <input
                  type="text"
                  value={runCode}
                  onChange={(e) => setRunCode(e.target.value)}
                  placeholder="Huruf dan angka bebas"
                  className="w-full rounded-xl border border-border-sky bg-white px-4 py-3 text-sm font-bold text-ink focus:border-primary-600 focus:outline-none focus:ring-2 focus:ring-primary/25"
                />
              </div>
            )}
          </div>

          <div className="pt-2 flex items-center justify-end gap-3">
            <Link
              href="/absen"
              className="rounded-2xl border border-border-sky bg-white hover:bg-page px-6 py-4 text-base font-bold text-ink transition min-h-[56px] flex items-center"
            >
              Batal
            </Link>
            <button
              type="submit"
              disabled={submitting}
              className="inline-flex items-center gap-2 rounded-2xl bg-primary-600 hover:bg-primary-700 disabled:opacity-60 text-white px-8 py-4 text-base font-extrabold shadow-soft transition min-h-[56px]"
            >
              {submitting ? (
                <Loader2 className="w-5 h-5 animate-spin" />
              ) : (
                <CheckCircle2 className="w-5 h-5" />
              )}
              <span>Catat Keberangkatan</span>
            </button>
          </div>
        </form>
      )}

      {/* Step 2B-1: Pilih trip jika > 1 trip terbuka */}
      {ctx && ctx.openTrips.length > 1 && !selectedOpenTrip && (
        <div className="rounded-2xl bg-surface border-2 border-border-sky shadow-card p-6 space-y-4">
          <h2 className="text-xl font-extrabold text-ink">
            Pilih Perjalanan {tripType} yang Akan Ditutup
          </h2>
          <p className="text-sm text-ink-muted">
            Terdapat {ctx.openTrips.length} trip aktif untuk {ctx.employee.name}.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {ctx.openTrips.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setSelectedOpenTrip(t)}
                className="text-left rounded-2xl border-2 border-border-sky hover:border-primary-500 bg-page/60 hover:bg-primary-50 p-5 transition space-y-2"
              >
                <div className="flex items-center justify-between">
                  <span className="text-lg font-extrabold text-ink">{t.plate}</span>
                  <span className="rounded-lg bg-primary-100 text-primary-700 px-2.5 py-1 text-xs font-bold">
                    Durasi {t.estimatedDurationHHMM}
                  </span>
                </div>
                <div className="text-xs text-ink-muted">
                  Keluar: {t.departFormattedDate} {t.departFormattedTime}
                </div>
                <div className="text-sm font-semibold text-ink">
                  {t.trip_type === 'FLM' ? `Area: ${t.area?.name ?? '-'}` : `Run: ${t.run_code ?? '-'}`}
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Step 2B-2: Mode KEMBALI */}
      {ctx && selectedOpenTrip && (
        <form
          onSubmit={handleSubmitReturn}
          className="rounded-2xl bg-surface border-2 border-border-sky shadow-card p-6 lg:p-8 space-y-6"
        >
          <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-border-sky">
            <div>
              <span className="inline-flex rounded-lg bg-emerald-100 text-emerald-800 px-3 py-1 text-xs font-extrabold uppercase">
                Mode Kembali (Pulang Tugas)
              </span>
              <h2 className="text-xl font-extrabold text-ink mt-1.5">
                Konfirmasi Kepulangan {tripType}
              </h2>
            </div>
            <div className="rounded-xl bg-page border border-border-sky px-4 py-2.5 text-right">
              <div className="text-[11px] font-semibold text-ink-muted">Jam Kembali Otomatis</div>
              <div className="text-sm font-extrabold text-primary-700 tabular-nums">
                {ctx.serverFormattedDate} • {ctx.serverFormattedTime}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3.5">
            <div className="rounded-xl bg-page border border-border-sky p-3.5">
              <div className="text-xs font-semibold text-ink-muted">Staff 1</div>
              <div className="text-sm font-extrabold text-ink mt-0.5">
                {selectedOpenTrip.staff1?.name ?? '-'}
              </div>
            </div>
            <div className="rounded-xl bg-page border border-border-sky p-3.5">
              <div className="text-xs font-semibold text-ink-muted">Staff 2</div>
              <div className="text-sm font-extrabold text-ink mt-0.5">
                {selectedOpenTrip.staff2?.name ?? '-'}
              </div>
            </div>
            <div className="rounded-xl bg-page border border-border-sky p-3.5">
              <div className="text-xs font-semibold text-ink-muted">Pengawal & Vendor</div>
              <div className="text-sm font-extrabold text-ink mt-0.5">
                {selectedOpenTrip.escort
                  ? `${selectedOpenTrip.escort.name} (${selectedOpenTrip.escort.vendor})`
                  : '-'}
              </div>
            </div>
            <div className="rounded-xl bg-page border border-border-sky p-3.5">
              <div className="text-xs font-semibold text-ink-muted">Nopol</div>
              <div className="text-base font-extrabold text-primary-700 mt-0.5 flex items-center gap-1.5">
                <Car className="w-4 h-4" />
                <span>{selectedOpenTrip.plate}</span>
              </div>
            </div>
            <div className="rounded-xl bg-page border border-border-sky p-3.5">
              <div className="text-xs font-semibold text-ink-muted">Waktu Keluar</div>
              <div className="text-xs font-bold text-ink mt-1">
                {selectedOpenTrip.departFormattedTime}
              </div>
            </div>
            <div className="rounded-xl bg-page border border-border-sky p-3.5">
              <div className="text-xs font-semibold text-ink-muted">
                {tripType === 'FLM' ? 'Area' : 'Run'}
              </div>
              <div className="text-sm font-extrabold text-ink mt-0.5 flex items-center gap-1">
                <MapPin className="w-3.5 h-3.5 text-primary-600" />
                <span>
                  {tripType === 'FLM'
                    ? selectedOpenTrip.area?.name ?? '-'
                    : selectedOpenTrip.run_code ?? '-'}
                </span>
              </div>
            </div>
            <div className="rounded-xl bg-page border border-border-sky p-3.5">
              <div className="text-xs font-semibold text-ink-muted">KM Awal</div>
              <div className="text-base font-extrabold text-ink tabular-nums mt-0.5">
                {selectedOpenTrip.km_start.toLocaleString('id-ID')}
              </div>
            </div>
            <div className="rounded-xl bg-primary-50 border border-primary-200 p-3.5">
              <div className="text-xs font-semibold text-primary-700">Durasi (HH-MM)</div>
              <div className="text-lg font-extrabold text-primary-700 tabular-nums mt-0.5 flex items-center gap-1.5">
                <Clock className="w-4 h-4" />
                <span>{selectedOpenTrip.estimatedDurationHHMM}</span>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-end rounded-2xl bg-primary-50/70 border-2 border-primary-200 p-5">
            <div>
              <label className="block text-sm font-extrabold text-ink mb-1.5">
                Input KM Akhir * (Minimal {selectedOpenTrip.km_start.toLocaleString('id-ID')})
              </label>
              <input
                type="number"
                inputMode="numeric"
                autoFocus
                min={selectedOpenTrip.km_start}
                value={kmEnd}
                onChange={(e) => setKmEnd(e.target.value)}
                placeholder="Masukkan KM odometer saat kembali"
                className="w-full rounded-xl border-2 border-primary-300 bg-white px-4 py-3.5 text-lg font-extrabold text-ink focus:border-primary-600 focus:outline-none"
              />
            </div>

            <div className="rounded-xl bg-white border border-border-sky px-5 py-3.5">
              <div className="text-xs font-semibold text-ink-muted">Total KM (Otomatis)</div>
              <div className="text-2xl font-extrabold text-primary-700 tabular-nums">
                {liveReturnTotalKm !== null
                  ? `${liveReturnTotalKm.toLocaleString('id-ID')} km`
                  : '-'}
              </div>
            </div>
          </div>

          <div className="pt-2 flex items-center justify-end gap-3">
            <Link
              href="/absen"
              className="rounded-2xl border border-border-sky bg-white hover:bg-page px-6 py-4 text-base font-bold text-ink transition min-h-[56px] flex items-center"
            >
              Batal
            </Link>
            <button
              type="submit"
              disabled={submitting}
              className="inline-flex items-center gap-2 rounded-2xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 text-white px-8 py-4 text-base font-extrabold shadow-soft transition min-h-[56px]"
            >
              {submitting ? (
                <Loader2 className="w-5 h-5 animate-spin" />
              ) : (
                <CheckCircle2 className="w-5 h-5" />
              )}
              <span>Selesai & Simpan Kepulangan</span>
            </button>
          </div>
        </form>
      )}

      {/* Modal scanner sekunder untuk Staff 2 / Pengawal */}
      <Modal
        open={Boolean(subScanMode)}
        onClose={() => setSubScanMode(null)}
        title={subScanMode === 'staff2' ? 'Scan Wajah Staff 2' : 'Scan Wajah Pengawal'}
        maxWidthClass="max-w-3xl"
      >
        {subScanMode && (
          <DynamicFaceScanner
            purpose={subScanMode === 'staff2' ? 'employee' : 'escort'}
            title={subScanMode === 'staff2' ? 'Identifikasi Staff 2' : 'Identifikasi Pengawal'}
            onResult={handleSubScanResult}
            onCancel={() => setSubScanMode(null)}
            showEnrollHintLink={false}
          />
        )}
      </Modal>

      <AttendanceSuccessModal
        open={Boolean(successModal)}
        title={successModal?.title ?? ''}
        subtitle={successModal?.subtitle}
        name={successModal?.name ?? ''}
        dateLabel={successModal?.dateLabel ?? ''}
        timeLabel={successModal?.timeLabel ?? ''}
        extraRows={successModal?.extraRows}
        onClose={() => {
          setSuccessModal(null);
          router.push('/absen');
        }}
      />
    </div>
  );
}

