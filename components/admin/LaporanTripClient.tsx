'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowUpDown,
  Calendar,
  Download,
  Edit3,
  History,
  Loader2,
  Search,
  Truck,
} from 'lucide-react';
import { toast } from 'sonner';
import type { TripType } from '@/types/database';
import {
  formatDurationHHMM,
  formatWibDateTime,
  formatWibDateTimeExcel,
  toWibDatetimeLocal,
} from '@/lib/time';
import { exportRowsToExcel } from '@/lib/excel';
import { Modal } from '@/components/ui/Modal';
import { EmptyState } from '@/components/ui/EmptyState';
import { TableSkeleton } from '@/components/ui/Skeleton';
import { DataTablePagination } from '@/components/ui/DataTablePagination';
import { AutocompleteInput } from '@/components/ui/AutocompleteInput';

interface TripReportRow {
  id: string;
  trip_type: TripType;
  depart_at: string;
  return_at: string | null;
  staff1_id: string;
  staff2_id: string | null;
  escort_id: string | null;
  plate: string;
  km_start: number;
  km_end: number | null;
  area_id: string | null;
  run_code: string | null;
  duration_minutes: number | null;
  total_km: number | null;
  staff1: { id: string; name: string; position: string } | null;
  staff2: { id: string; name: string; position: string } | null;
  escort: { id: string; name: string; vendor: string } | null;
  area: { id: string; name: string } | null;
}

interface AuditItem {
  id: string;
  reason: string | null;
  actor_name: string;
  created_at: string;
}

export function LaporanTripClient({ tripType }: { tripType: TripType }) {
  const kind = tripType.toLowerCase();
  const [items, setItems] = useState<TripReportRow[]>([]);
  const [employees, setEmployees] = useState<{ id: string; name: string }[]>([]);
  const [escorts, setEscorts] = useState<{ id: string; name: string; vendor: string }[]>([]);
  const [plates, setPlates] = useState<string[]>([]);
  const [areas, setAreas] = useState<{ id: string; name: string }[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditItem[]>([]);
  const [loading, setLoading] = useState(true);

  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [employeeFilter, setEmployeeFilter] = useState('');
  const [plateFilter, setPlateFilter] = useState('');
  const [search, setSearch] = useState('');
  const [sortAsc, setSortAsc] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(15);

  const [auditOpen, setAuditOpen] = useState(false);
  const [editing, setEditing] = useState<TripReportRow | null>(null);
  const [corrDepart, setCorrDepart] = useState('');
  const [corrReturn, setCorrReturn] = useState('');
  const [corrStaff2, setCorrStaff2] = useState('');
  const [corrEscort, setCorrEscort] = useState('');
  const [corrPlate, setCorrPlate] = useState('');
  const [corrKmStart, setCorrKmStart] = useState('');
  const [corrKmEnd, setCorrKmEnd] = useState('');
  const [corrAreaId, setCorrAreaId] = useState('');
  const [corrRunCode, setCorrRunCode] = useState('');
  const [corrReason, setCorrReason] = useState('');
  const [saving, setSaving] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ kind });
      if (fromDate) params.set('from', fromDate);
      if (toDate) params.set('to', toDate);
      if (employeeFilter) params.set('employee_id', employeeFilter);
      if (plateFilter) params.set('plate', plateFilter);

      const res = await fetch(`/api/laporan?${params.toString()}`, { cache: 'no-store' });
      const json = (await res.json()) as {
        items?: TripReportRow[];
        employees?: { id: string; name: string }[];
        escorts?: { id: string; name: string; vendor: string }[];
        plates?: string[];
        areas?: { id: string; name: string }[];
        auditLogs?: AuditItem[];
        error?: string;
      };
      if (!res.ok) {
        toast.error(json.error ?? `Gagal memuat laporan ${tripType}.`);
        return;
      }
      setItems(json.items ?? []);
      setEmployees(json.employees ?? []);
      setEscorts(json.escorts ?? []);
      setPlates(json.plates ?? []);
      setAreas(json.areas ?? []);
      setAuditLogs(json.auditLogs ?? []);
    } catch {
      toast.error('Gagal terhubung ke server.');
    } finally {
      setLoading(false);
    }
  }, [kind, tripType, fromDate, toDate, employeeFilter, plateFilter]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = items.filter((item) => {
      if (!q) return true;
      return [
        item.staff1?.name,
        item.staff2?.name,
        item.escort?.name,
        item.escort?.vendor,
        item.plate,
        item.area?.name,
        item.run_code,
      ]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q));
    });
    return [...list].sort((a, b) =>
      sortAsc ? a.depart_at.localeCompare(b.depart_at) : b.depart_at.localeCompare(a.depart_at)
    );
  }, [items, search, sortAsc]);

  const paginated = useMemo(() => {
    const start = (page - 1) * pageSize;
    return filtered.slice(start, start + pageSize);
  }, [filtered, page, pageSize]);

  useEffect(() => {
    setPage(1);
  }, [search, fromDate, toDate, employeeFilter, plateFilter]);

  const openCorrection = (row: TripReportRow) => {
    setEditing(row);
    setCorrDepart(toWibDatetimeLocal(row.depart_at));
    setCorrReturn(toWibDatetimeLocal(row.return_at));
    setCorrStaff2(row.staff2_id ?? '');
    setCorrEscort(row.escort_id ?? '');
    setCorrPlate(row.plate);
    setCorrKmStart(String(row.km_start));
    setCorrKmEnd(row.km_end !== null ? String(row.km_end) : '');
    setCorrAreaId(row.area_id ?? '');
    setCorrRunCode(row.run_code ?? '');
    setCorrReason('');
  };

  const handleSaveCorrection = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editing) return;
    if (corrReason.trim().length < 5) {
      toast.error('Alasan koreksi wajib diisi minimal 5 karakter.');
      return;
    }

    setSaving(true);
    try {
      const res = await fetch('/api/laporan', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          target: 'trip',
          id: editing.id,
          depart_local: corrDepart,
          return_local: corrReturn || null,
          staff2_id: corrStaff2 || null,
          escort_id: corrEscort || null,
          plate: corrPlate,
          km_start: Number(corrKmStart),
          km_end: corrKmEnd === '' ? null : Number(corrKmEnd),
          area_id: tripType === 'FLM' ? corrAreaId : null,
          run_code: tripType !== 'FLM' ? corrRunCode : null,
          reason: corrReason.trim(),
        }),
      });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) {
        toast.error(json.error ?? 'Gagal menyimpan koreksi trip.');
        return;
      }
      toast.success(`Koreksi mutasi ${tripType} disimpan ke audit log.`);
      setEditing(null);
      await loadData();
    } catch {
      toast.error('Gagal terhubung ke server.');
    } finally {
      setSaving(false);
    }
  };

  const handleExport = () => {
    const lastCol = tripType === 'FLM' ? 'AREA' : 'RUN';
    const headers = [
      'KELUAR',
      'KEMBALI',
      'STAFF 1',
      'STAFF 2',
      'DURASI',
      'NAMA PENGAWAL',
      'VENDOR',
      'NOPOL',
      'KM AWAL',
      'KM AKHIR',
      'TOTAL KM',
      lastCol,
    ];
    const rows = filtered.map((r) => ({
      KELUAR: formatWibDateTimeExcel(r.depart_at),
      KEMBALI: formatWibDateTimeExcel(r.return_at),
      'STAFF 1': r.staff1?.name ?? '',
      'STAFF 2': r.staff2?.name ?? '',
      DURASI: r.duration_minutes !== null ? formatDurationHHMM(r.duration_minutes) : '',
      'NAMA PENGAWAL': r.escort?.name ?? '',
      VENDOR: r.escort?.vendor ?? '',
      NOPOL: r.plate,
      'KM AWAL': r.km_start,
      'KM AKHIR': r.km_end ?? '',
      'TOTAL KM': r.total_km ?? '',
      [lastCol]: tripType === 'FLM' ? r.area?.name ?? '' : r.run_code ?? '',
    }));
    exportRowsToExcel(`Mutasi_${tripType}.xlsx`, `Mutasi ${tripType}`, rows, headers);
    toast.success(`Export Mutasi ${tripType} berhasil.`);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-extrabold text-ink">Laporan Mutasi {tripType}</h1>
          <p className="text-sm text-ink-muted mt-0.5">
            Rekap perjalanan keluar dan kembali armada {tripType} lengkap dengan durasi dan total KM.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            onClick={() => setAuditOpen(true)}
            className="inline-flex items-center gap-2 rounded-xl border border-border-sky bg-white hover:bg-page px-4 py-2.5 text-sm font-semibold text-ink shadow-sm transition"
          >
            <History className="w-4 h-4 text-primary-600" />
            <span>Audit Koreksi ({auditLogs.length})</span>
          </button>
          <button
            type="button"
            onClick={handleExport}
            disabled={filtered.length === 0}
            className="inline-flex items-center gap-2 rounded-xl bg-primary-600 hover:bg-primary-700 disabled:opacity-50 text-white px-4 py-2.5 text-sm font-semibold shadow-soft transition"
          >
            <Download className="w-4 h-4" />
            <span>Export Excel</span>
          </button>
        </div>
      </div>

      <div className="rounded-2xl bg-surface border border-border-sky shadow-soft overflow-hidden">
        <div className="p-4 border-b border-border-sky flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="w-4 h-4 text-ink-muted absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Cari staff, pengawal, area/run..."
              className="w-full rounded-xl border border-border-sky bg-page/50 pl-10 pr-4 py-2.5 text-sm focus:border-primary-600 focus:bg-white focus:outline-none"
            />
          </div>

          <select
            value={employeeFilter}
            onChange={(e) => setEmployeeFilter(e.target.value)}
            className="rounded-xl border border-border-sky bg-white px-3 py-2.5 text-xs font-semibold text-ink focus:border-primary-600 focus:outline-none"
          >
            <option value="">Semua Karyawan</option>
            {employees.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name}
              </option>
            ))}
          </select>

          <select
            value={plateFilter}
            onChange={(e) => setPlateFilter(e.target.value)}
            className="rounded-xl border border-border-sky bg-white px-3 py-2.5 text-xs font-semibold text-ink focus:border-primary-600 focus:outline-none"
          >
            <option value="">Semua Nopol</option>
            {plates.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>

          <div className="flex flex-wrap items-center gap-2 text-xs">
            <Calendar className="w-4 h-4 text-ink-muted" />
            <input
              type="date"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
              className="rounded-xl border border-border-sky bg-white px-3 py-2 text-xs focus:border-primary-600 focus:outline-none"
            />
            <span className="text-ink-muted">s/d</span>
            <input
              type="date"
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
              className="rounded-xl border border-border-sky bg-white px-3 py-2 text-xs focus:border-primary-600 focus:outline-none"
            />
          </div>
        </div>

        {loading ? (
          <TableSkeleton rows={6} cols={10} />
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={Truck}
            title={`Belum ada laporan mutasi ${tripType}`}
            description="Perjalanan yang dicatat di tablet pos security akan tampil di sini."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs sm:text-sm text-left">
              <thead className="bg-primary-50 text-ink font-bold text-xs uppercase tracking-wider">
                <tr>
                  <th className="px-3 py-3">
                    <button
                      type="button"
                      onClick={() => setSortAsc((p) => !p)}
                      className="inline-flex items-center gap-1 hover:text-primary-700"
                    >
                      <span>Keluar</span>
                      <ArrowUpDown className="w-3.5 h-3.5 opacity-60" />
                    </button>
                  </th>
                  <th className="px-3 py-3">Kembali</th>
                  <th className="px-3 py-3">Staff 1</th>
                  <th className="px-3 py-3">Staff 2</th>
                  <th className="px-3 py-3">Durasi</th>
                  <th className="px-3 py-3">Nama Pengawal</th>
                  <th className="px-3 py-3">Vendor</th>
                  <th className="px-3 py-3">Nopol</th>
                  <th className="px-3 py-3">KM Awal</th>
                  <th className="px-3 py-3">KM Akhir</th>
                  <th className="px-3 py-3">Total KM</th>
                  <th className="px-3 py-3">{tripType === 'FLM' ? 'Area' : 'Run'}</th>
                  <th className="px-3 py-3 text-right">Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-sky">
                {paginated.map((row) => (
                  <tr key={row.id} className="hover:bg-page/50">
                    <td className="px-3 py-3 whitespace-nowrap tabular-nums">
                      {formatWibDateTime(row.depart_at)}
                    </td>
                    <td className="px-3 py-3 whitespace-nowrap tabular-nums">
                      {row.return_at ? (
                        formatWibDateTime(row.return_at)
                      ) : (
                        <span className="inline-flex rounded-full bg-amber-100 text-amber-800 px-2 py-0.5 text-[11px] font-bold">
                          Aktif
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-3 font-semibold text-ink">{row.staff1?.name ?? '-'}</td>
                    <td className="px-3 py-3 text-ink-muted">{row.staff2?.name ?? '-'}</td>
                    <td className="px-3 py-3 font-bold tabular-nums text-primary-700">
                      {formatDurationHHMM(row.duration_minutes)}
                    </td>
                    <td className="px-3 py-3">{row.escort?.name ?? '-'}</td>
                    <td className="px-3 py-3 text-ink-muted">{row.escort?.vendor ?? '-'}</td>
                    <td className="px-3 py-3 font-bold text-ink whitespace-nowrap">{row.plate}</td>
                    <td className="px-3 py-3 tabular-nums">
                      {row.km_start.toLocaleString('id-ID')}
                    </td>
                    <td className="px-3 py-3 tabular-nums">
                      {row.km_end !== null ? row.km_end.toLocaleString('id-ID') : '-'}
                    </td>
                    <td className="px-3 py-3 tabular-nums font-bold text-emerald-700">
                      {row.total_km !== null ? `${row.total_km.toLocaleString('id-ID')} km` : '-'}
                    </td>
                    <td className="px-3 py-3 font-semibold">
                      {tripType === 'FLM' ? row.area?.name ?? '-' : row.run_code ?? '-'}
                    </td>
                    <td className="px-3 py-3 text-right">
                      <button
                        type="button"
                        onClick={() => openCorrection(row)}
                        className="inline-flex items-center gap-1 rounded-lg border border-border-sky bg-white hover:bg-primary-50 hover:text-primary-700 px-2.5 py-1.5 text-xs font-semibold transition"
                      >
                        <Edit3 className="w-3.5 h-3.5" />
                        <span>Koreksi</span>
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <DataTablePagination
          totalItems={filtered.length}
          page={page}
          pageSize={pageSize}
          onPageChange={setPage}
          onPageSizeChange={setPageSize}
        />
      </div>

      {/* Modal Koreksi Trip */}
      <Modal
        open={Boolean(editing)}
        onClose={() => setEditing(null)}
        title={`Koreksi Mutasi ${tripType} — ${editing?.staff1?.name ?? ''}`}
        description="Perubahan oleh admin tercatat di Audit Log beserta alasan wajib."
        maxWidthClass="max-w-2xl"
      >
        <form onSubmit={handleSaveCorrection} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-semibold text-ink mb-1">Waktu Keluar (WIB)</label>
              <input
                type="datetime-local"
                value={corrDepart}
                onChange={(e) => setCorrDepart(e.target.value)}
                className="w-full rounded-xl border border-border-sky px-3 py-2.5 text-sm focus:border-primary-600 focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-sm font-semibold text-ink mb-1">Waktu Kembali (WIB)</label>
              <input
                type="datetime-local"
                value={corrReturn}
                onChange={(e) => setCorrReturn(e.target.value)}
                className="w-full rounded-xl border border-border-sky px-3 py-2.5 text-sm focus:border-primary-600 focus:outline-none"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-semibold text-ink mb-1">Staff 2</label>
              <select
                value={corrStaff2}
                onChange={(e) => setCorrStaff2(e.target.value)}
                className="w-full rounded-xl border border-border-sky px-3 py-2.5 text-sm focus:border-primary-600 focus:outline-none"
              >
                <option value="">-- Tidak ada --</option>
                {employees
                  .filter((e) => e.id !== editing?.staff1_id)
                  .map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.name}
                    </option>
                  ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-semibold text-ink mb-1">Pengawal</label>
              <select
                value={corrEscort}
                onChange={(e) => setCorrEscort(e.target.value)}
                className="w-full rounded-xl border border-border-sky px-3 py-2.5 text-sm focus:border-primary-600 focus:outline-none"
              >
                <option value="">-- Tidak ada --</option>
                {escorts.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.name} ({e.vendor})
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="block text-sm font-semibold text-ink mb-1">Nopol</label>
              <AutocompleteInput
                options={plates.map((p) => ({ value: p, label: p }))}
                value={corrPlate}
                onChange={(v) => setCorrPlate(v)}
                allowFreeText
                uppercase
              />
            </div>
            <div>
              <label className="block text-sm font-semibold text-ink mb-1">KM Awal</label>
              <input
                type="number"
                min={0}
                value={corrKmStart}
                onChange={(e) => setCorrKmStart(e.target.value)}
                className="w-full rounded-xl border border-border-sky px-3 py-2.5 text-sm focus:border-primary-600 focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-sm font-semibold text-ink mb-1">KM Akhir</label>
              <input
                type="number"
                min={0}
                value={corrKmEnd}
                onChange={(e) => setCorrKmEnd(e.target.value)}
                className="w-full rounded-xl border border-border-sky px-3 py-2.5 text-sm focus:border-primary-600 focus:outline-none"
              />
            </div>
          </div>

          {tripType === 'FLM' ? (
            <div>
              <label className="block text-sm font-semibold text-ink mb-1">Area</label>
              <select
                value={corrAreaId}
                onChange={(e) => setCorrAreaId(e.target.value)}
                className="w-full rounded-xl border border-border-sky px-3 py-2.5 text-sm focus:border-primary-600 focus:outline-none"
              >
                {areas.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </div>
          ) : (
            <div>
              <label className="block text-sm font-semibold text-ink mb-1">Kode RUN</label>
              <input
                type="text"
                value={corrRunCode}
                onChange={(e) => setCorrRunCode(e.target.value)}
                className="w-full rounded-xl border border-border-sky px-3 py-2.5 text-sm focus:border-primary-600 focus:outline-none"
              />
            </div>
          )}

          <div>
            <label className="block text-sm font-semibold text-ink mb-1">Alasan Koreksi *</label>
            <textarea
              rows={2}
              required
              value={corrReason}
              onChange={(e) => setCorrReason(e.target.value)}
              placeholder="Contoh: Karyawan lupa menutup perjalanan saat kembali ke kantor"
              className="w-full rounded-xl border border-border-sky px-3.5 py-2.5 text-sm focus:border-primary-600 focus:outline-none"
            />
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={() => setEditing(null)}
              className="rounded-xl border border-border-sky px-4 py-2.5 text-sm font-semibold"
            >
              Batal
            </button>
            <button
              type="submit"
              disabled={saving}
              className="rounded-xl bg-primary-600 hover:bg-primary-700 disabled:opacity-60 text-white px-5 py-2.5 text-sm font-semibold flex items-center gap-2"
            >
              {saving && <Loader2 className="w-4 h-4 animate-spin" />}
              <span>Simpan Koreksi</span>
            </button>
          </div>
        </form>
      </Modal>

      <Modal
        open={auditOpen}
        onClose={() => setAuditOpen(false)}
        title={`Riwayat Koreksi Trip (Audit Log)`}
        maxWidthClass="max-w-2xl"
      >
        {auditLogs.length === 0 ? (
          <p className="text-sm text-ink-muted py-6 text-center">Belum ada riwayat koreksi.</p>
        ) : (
          <div className="space-y-3 max-h-96 overflow-y-auto">
            {auditLogs.map((log) => (
              <div key={log.id} className="rounded-xl bg-page border border-border-sky p-3.5 text-xs space-y-1">
                <div className="flex justify-between font-bold text-ink">
                  <span>Oleh: {log.actor_name}</span>
                  <span className="text-ink-muted">{formatWibDateTime(log.created_at)} WIB</span>
                </div>
                <div className="text-ink-muted">
                  Alasan: <strong className="text-ink">{log.reason || '-'}</strong>
                </div>
              </div>
            ))}
          </div>
        )}
      </Modal>
    </div>
  );
}

