'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Loader2,
  RefreshCw,
  XCircle,
} from 'lucide-react';
import { toast } from 'sonner';
import { formatWibDateTime } from '@/lib/time';
import { Modal } from '@/components/ui/Modal';
import { AutocompleteInput } from '@/components/ui/AutocompleteInput';

interface AttendanceReviewEvent {
  id: string;
  attendance_id: string;
  employee_id: string;
  event_type: 'masuk' | 'istirahat' | 'istirahat_kembali' | 'pulang';
  event_time: string;
  match_distance: number | null;
  second_subject_id: string | null;
  second_distance: number | null;
  margin: number | null;
  decision_zone: string | null;
  frames_used: number | null;
  verification_id: string | null;
  voided_at: string | null;
  void_reason: string | null;
  created_at: string;
  employee?: { id: string; name: string; employee_no: string } | null;
  second_employee?: { id: string; name: string; employee_no: string } | null;
  verification?: { id: string; confirmed_method: string | null; confirm_attempts: number } | null;
}

interface ReviewStats {
  confirm_count: number;
  voided_count: number;
}

export function FaceReviewClient() {
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'confirm' | 'low_margin' | 'voided'>('confirm');
  const [events, setEvents] = useState<AttendanceReviewEvent[]>([]);
  const [stats, setStats] = useState<ReviewStats>({ confirm_count: 0, voided_count: 0 });

  // Koreksi modal state
  const [correctModalOpen, setCorrectModalOpen] = useState(false);
  const [selectedEvent, setSelectedEvent] = useState<AttendanceReviewEvent | null>(null);
  const [employees, setEmployees] = useState<{ id: string; name: string; employee_no: string }[]>([]);
  const [targetEmployeeId, setTargetEmployeeId] = useState('');
  const [correctionReason, setCorrectionReason] = useState('');
  const [savingCorrection, setSavingCorrection] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/face/review?filter=${filter}`, { cache: 'no-store' });
      const json = await res.json();
      if (!res.ok) {
        toast.error(json.error ?? 'Gagal memuat data review absensi.');
        return;
      }
      setEvents(json.events ?? []);
      if (json.stats_7d) setStats(json.stats_7d);
    } catch {
      toast.error('Gagal terhubung ke server.');
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Load employee list for correction dropdown
  useEffect(() => {
    async function loadEmployees() {
      try {
        const res = await fetch('/api/master/employees', { cache: 'no-store' });
        const json = await res.json();
        if (res.ok && Array.isArray(json.employees)) {
          setEmployees(json.employees);
        }
      } catch {
        // Abaikan
      }
    }
    loadEmployees();
  }, []);

  const handleMarkValid = async (eventId: string) => {
    try {
      const res = await fetch('/api/admin/face/review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ event_id: eventId, action: 'mark_valid' }),
      });
      const json = await res.json();
      if (!res.ok) {
        toast.error(json.error ?? 'Gagal menandai valid.');
        return;
      }
      toast.success('Event absensi ditandai valid.');
      loadData();
    } catch {
      toast.error('Gagal terhubung ke server.');
    }
  };

  const handleOpenCorrectModal = (event: AttendanceReviewEvent) => {
    setSelectedEvent(event);
    setTargetEmployeeId('');
    setCorrectionReason('');
    setCorrectModalOpen(true);
  };

  const handleSubmitCorrection = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedEvent || !targetEmployeeId) {
      toast.error('Pilih karyawan tujuan koreksi.');
      return;
    }
    if (correctionReason.trim().length < 5) {
      toast.error('Alasan koreksi wajib diisi (minimal 5 karakter).');
      return;
    }

    setSavingCorrection(true);
    try {
      const res = await fetch('/api/admin/face/review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          event_id: selectedEvent.id,
          action: 'correct_person',
          correct_employee_id: targetEmployeeId,
          reason: correctionReason.trim(),
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        toast.error(json.error ?? 'Gagal memproses koreksi.');
        return;
      }
      toast.success(json.message ?? 'Absensi berhasil dikoreksi.');
      setCorrectModalOpen(false);
      loadData();
    } catch {
      toast.error('Gagal memproses koreksi.');
    } finally {
      setSavingCorrection(false);
    }
  };

  const employeeOptions = employees.map((e) => ({
    value: e.id,
    label: e.name,
    sublabel: `No ID: ${e.employee_no}`,
  }));

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-extrabold text-ink">Review & Audit Absensi Wajah</h1>
          <p className="text-sm text-ink-muted mt-0.5">
            Verifikasi event absensi dengan zona konfirmasi, margin tipis, atau pembatalan mandiri karyawan.
          </p>
        </div>

        <button
          type="button"
          onClick={loadData}
          disabled={loading}
          className="inline-flex items-center gap-2 rounded-xl bg-primary-600 hover:bg-primary-700 disabled:opacity-50 text-white px-4 py-2.5 text-xs font-bold shadow-soft transition"
        >
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
          <span>Segarkan Data</span>
        </button>
      </div>

      {/* KPI Cards (7 Hari Terakhir) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
        <div className="rounded-2xl bg-amber-50/70 border border-amber-200 p-4 shadow-soft">
          <span className="text-xs font-bold text-amber-800 flex items-center gap-1.5">
            <AlertTriangle className="w-3.5 h-3.5" /> Zona Konfirmasi (7 Hari)
          </span>
          <div className="text-2xl font-black text-amber-900 mt-1">{stats.confirm_count}</div>
          <span className="text-[11px] text-amber-700">Verifikasi dengan 2nd factor (No ID/RFID)</span>
        </div>

        <div className="rounded-2xl bg-rose-50/70 border border-rose-200 p-4 shadow-soft">
          <span className="text-xs font-bold text-rose-800 flex items-center gap-1.5">
            <XCircle className="w-3.5 h-3.5" /> Dibatalkan Mandiri (7 Hari)
          </span>
          <div className="text-2xl font-black text-rose-900 mt-1">{stats.voided_count}</div>
          <span className="text-[11px] text-rose-700">Melalui tombol &ldquo;Bukan saya? Batalkan&rdquo;</span>
        </div>

        <div className="rounded-2xl bg-surface border border-border-sky p-4 shadow-soft">
          <span className="text-xs font-bold text-ink-muted">Aksi Diperlukan</span>
          <div className="text-2xl font-black text-ink mt-1">
            {stats.voided_count > 0 ? `${stats.voided_count} Perlu Tindak Lanjut` : 'Semua Beres'}
          </div>
          <span className="text-[11px] text-ink-muted">Pastikan absensi tidak tertukar</span>
        </div>
      </div>

      {/* Filter Tabs */}
      <div className="flex flex-wrap items-center gap-2">
        {[
          { key: 'confirm', label: 'Zona Konfirmasi' },
          { key: 'low_margin', label: 'Margin Tipis (< 0.10)' },
          { key: 'voided', label: 'Dibatalkan (Voided)' },
          { key: 'all', label: 'Semua Event' },
        ].map((f) => (
          <button
            key={f.key}
            type="button"
            onClick={() => setFilter(f.key as typeof filter)}
            className={`rounded-xl px-4 py-2.5 text-xs font-bold transition border ${
              filter === f.key
                ? 'bg-primary-600 text-white border-primary-600 shadow-soft'
                : 'bg-surface text-ink-muted border-border-sky hover:text-ink'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* Tabel Events */}
      <div className="rounded-2xl bg-surface border border-border-sky shadow-soft overflow-hidden">
        {loading ? (
          <div className="p-12 text-center text-xs text-ink-muted flex flex-col items-center gap-2">
            <Loader2 className="w-6 h-6 animate-spin text-primary" />
            <span>Memuat riwayat event verifikasi...</span>
          </div>
        ) : events.length === 0 ? (
          <div className="p-12 text-center text-xs text-ink-muted">
            Tidak ada event absensi yang cocok dengan filter ini.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left">
              <thead className="bg-primary-50 text-ink font-bold uppercase tracking-wider">
                <tr>
                  <th className="px-4 py-3">Waktu (WIB)</th>
                  <th className="px-4 py-3">Karyawan Teridentifikasi</th>
                  <th className="px-4 py-3">Tipe Absen</th>
                  <th className="px-4 py-3">Kandidat Ke-2</th>
                  <th className="px-4 py-3">Skor & Margin</th>
                  <th className="px-4 py-3">Zona & Metode</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3 text-right">Aksi Admin</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-sky">
                {events.map((ev) => {
                  const isVoided = Boolean(ev.voided_at);
                  const isConfirm = ev.decision_zone === 'confirm';
                  const isLowMargin = (ev.margin ?? 1) < 0.10;

                  return (
                    <tr
                      key={ev.id}
                      className={`hover:bg-page/50 ${isVoided ? 'bg-rose-50/30' : ''}`}
                    >
                      <td className="px-4 py-3 font-mono text-ink-muted whitespace-nowrap">
                        {formatWibDateTime(ev.event_time)}
                      </td>
                      <td className="px-4 py-3">
                        <div className="font-bold text-ink">{ev.employee?.name ?? 'Tidak Diketahui'}</div>
                        <div className="text-[11px] text-ink-muted">ID: {ev.employee?.employee_no ?? '-'}</div>
                      </td>
                      <td className="px-4 py-3">
                        <span className="font-semibold capitalize text-ink">
                          {ev.event_type.replace('_', ' ')}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        {ev.second_employee ? (
                          <div>
                            <span className="font-semibold text-ink">{ev.second_employee.name}</span>
                            <div className="text-[11px] text-ink-muted font-mono">
                              d={ev.second_distance?.toFixed(3) ?? '-'}
                            </div>
                          </div>
                        ) : (
                          <span className="text-ink-muted">-</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <div className="font-mono">
                          <span className="font-bold text-ink">{ev.match_distance?.toFixed(3) ?? '-'}</span>
                          {ev.margin !== null && (
                            <span
                              className={`ml-1.5 text-[11px] font-bold ${
                                isLowMargin ? 'text-amber-600' : 'text-emerald-600'
                              }`}
                            >
                              (m={ev.margin.toFixed(3)})
                            </span>
                          )}
                        </div>
                        {ev.frames_used && (
                          <div className="text-[10px] text-ink-muted">{ev.frames_used} frame valid</div>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <div className="space-y-0.5">
                          <span
                            className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold ${
                              ev.decision_zone === 'accept'
                                ? 'bg-emerald-100 text-emerald-800'
                                : ev.decision_zone === 'confirm'
                                  ? 'bg-amber-100 text-amber-800'
                                  : 'bg-rose-100 text-rose-800'
                            }`}
                          >
                            {(ev.decision_zone ?? 'accept').toUpperCase()}
                          </span>
                          {ev.verification?.confirmed_method && (
                            <div className="text-[10px] text-ink-muted">
                              via: {ev.verification.confirmed_method}
                            </div>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        {isVoided ? (
                          <div className="space-y-0.5">
                            <span className="inline-flex items-center gap-1 rounded-full bg-rose-100 text-rose-800 px-2 py-0.5 text-[10px] font-bold">
                              <XCircle className="w-3 h-3" /> Dibatalkan
                            </span>
                            <div className="text-[10px] text-rose-600 max-w-xs truncate" title={ev.void_reason ?? ''}>
                              {ev.void_reason ?? 'Bukan saya'}
                            </div>
                          </div>
                        ) : (
                          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 text-emerald-800 px-2 py-0.5 text-[10px] font-bold">
                            <CheckCircle2 className="w-3 h-3" /> Tercatat
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          {!isVoided && isConfirm && (
                            <button
                              type="button"
                              onClick={() => handleMarkValid(ev.id)}
                              className="rounded-lg bg-surface hover:bg-page border border-border-sky px-2.5 py-1 text-xs font-semibold text-ink"
                            >
                              Valid
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => handleOpenCorrectModal(ev)}
                            className="rounded-lg bg-primary-600 hover:bg-primary-700 text-white px-2.5 py-1 text-xs font-bold transition"
                          >
                            Koreksi
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Modal Koreksi Orang */}
      <Modal
        open={correctModalOpen}
        onClose={() => {
          if (!savingCorrection) setCorrectModalOpen(false);
        }}
        title="Koreksi Karyawan Absensi"
        maxWidthClass="max-w-md"
      >
        {selectedEvent && (
          <form onSubmit={handleSubmitCorrection} className="space-y-4">
            <div className="rounded-xl bg-page border border-border-sky p-3 text-xs text-ink space-y-1">
              <div>
                <span className="text-ink-muted">Waktu:</span>{' '}
                <strong>{formatWibDateTime(selectedEvent.event_time)}</strong>
              </div>
              <div>
                <span className="text-ink-muted">Tipe Absen:</span>{' '}
                <strong className="capitalize">{selectedEvent.event_type.replace('_', ' ')}</strong>
              </div>
              <div>
                <span className="text-ink-muted">Tercatat sebagai:</span>{' '}
                <strong className="text-rose-600">
                  {selectedEvent.employee?.name} ({selectedEvent.employee?.employee_no})
                </strong>
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold text-ink mb-1.5">
                Pindahkan ke Karyawan Sebenarnya:
              </label>
              <AutocompleteInput
                options={employeeOptions}
                value={targetEmployeeId}
                onChange={setTargetEmployeeId}
                placeholder="Ketik nama atau No ID karyawan..."
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-ink mb-1.5">
                Alasan Koreksi (Wajib, Minimal 5 karakter):
              </label>
              <textarea
                value={correctionReason}
                onChange={(e) => setCorrectionReason(e.target.value)}
                placeholder="Misal: Salah deteksi wajah karena pencahayaan backlight, dikonfirmasi karyawan asli adalah Budi"
                rows={3}
                className="w-full rounded-xl border border-border-sky bg-page px-3 py-2 text-xs text-ink focus:border-primary-600 focus:bg-white focus:outline-none"
              />
            </div>

            <div className="flex items-center justify-end gap-2.5 pt-2">
              <button
                type="button"
                disabled={savingCorrection}
                onClick={() => setCorrectModalOpen(false)}
                className="rounded-xl border border-border-sky bg-white px-4 py-2 text-xs font-bold text-ink hover:bg-page"
              >
                Batal
              </button>
              <button
                type="submit"
                disabled={savingCorrection}
                className="inline-flex items-center gap-2 rounded-xl bg-primary-600 hover:bg-primary-700 disabled:opacity-50 text-white px-4 py-2 text-xs font-bold shadow-soft transition"
              >
                {savingCorrection && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                <span>Simpan Koreksi</span>
              </button>
            </div>
          </form>
        )}
      </Modal>
    </div>
  );
}
