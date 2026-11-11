'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowUpDown,
  Calendar,
  CheckCircle2,
  Download,
  Edit3,
  Loader2,
  Plus,
  Search,
  Trash2,
  Wrench,
} from 'lucide-react';
import { toast } from 'sonner';
import type { InsuranceType, WorkshopLog } from '@/types/database';
import { formatWibDateOnlyLabel, getWibDateString } from '@/lib/time';
import { exportRowsToExcel } from '@/lib/excel';
import { workshopLogSchema } from '@/lib/validators';
import { Modal } from '@/components/ui/Modal';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { EmptyState } from '@/components/ui/EmptyState';
import { TableSkeleton } from '@/components/ui/Skeleton';
import { DataTablePagination } from '@/components/ui/DataTablePagination';
import { AutocompleteInput } from '@/components/ui/AutocompleteInput';

function calcDaysBetween(start: string, end: string): number | null {
  if (!start || !end) return null;
  const s = new Date(`${start}T00:00:00Z`).getTime();
  const e = new Date(`${end}T00:00:00Z`).getTime();
  if (Number.isNaN(s) || Number.isNaN(e) || e < s) return null;
  return Math.round((e - s) / (1000 * 60 * 60 * 24));
}

export function MutasiBengkelClient() {
  const [items, setItems] = useState<WorkshopLog[]>([]);
  const [plates, setPlates] = useState<string[]>([]);
  const [workshops, setWorkshops] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [sortAsc, setSortAsc] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<WorkshopLog | null>(null);
  const [completeMode, setCompleteMode] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<WorkshopLog | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const [vehiclePlate, setVehiclePlate] = useState('');
  const [outDate, setOutDate] = useState(getWibDateString());
  const [kmOut, setKmOut] = useState('');
  const [finishDate, setFinishDate] = useState('');
  const [kmBack, setKmBack] = useState('');
  const [insuranceType, setInsuranceType] = useState<InsuranceType>('non_asuransi');
  const [workshopName, setWorkshopName] = useState('');
  const [notes, setNotes] = useState('');

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (fromDate) params.set('from', fromDate);
      if (toDate) params.set('to', toDate);
      const res = await fetch(`/api/mutasi/bengkel?${params.toString()}`, { cache: 'no-store' });
      const json = (await res.json()) as {
        items?: WorkshopLog[];
        plates?: string[];
        workshops?: string[];
        error?: string;
      };
      if (!res.ok) {
        toast.error(json.error ?? 'Gagal memuat data mutasi bengkel.');
        return;
      }
      setItems(json.items ?? []);
      setPlates(json.plates ?? []);
      setWorkshops(json.workshops ?? []);
    } catch {
      toast.error('Gagal terhubung ke server.');
    } finally {
      setLoading(false);
    }
  }, [fromDate, toDate]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const plateOptions = useMemo(() => plates.map((p) => ({ value: p, label: p })), [plates]);
  const workshopOptions = useMemo(() => workshops.map((w) => ({ value: w, label: w })), [workshops]);

  const previewTotalKm = useMemo(() => {
    if (!kmOut || !kmBack) return null;
    const diff = Number(kmBack) - Number(kmOut);
    return Number.isNaN(diff) || diff < 0 ? null : diff;
  }, [kmOut, kmBack]);

  const previewRepairDays = useMemo(
    () => calcDaysBetween(outDate, finishDate),
    [outDate, finishDate]
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = items.filter((i) => {
      if (!q) return true;
      return [i.vehicle_plate, i.workshop_name, i.notes]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q));
    });
    return [...list].sort((a, b) =>
      sortAsc ? a.out_date.localeCompare(b.out_date) : b.out_date.localeCompare(a.out_date)
    );
  }, [items, search, sortAsc]);

  const paginated = useMemo(() => {
    const start = (page - 1) * pageSize;
    return filtered.slice(start, start + pageSize);
  }, [filtered, page, pageSize]);

  useEffect(() => {
    setPage(1);
  }, [search, fromDate, toDate]);

  const openCreate = () => {
    setEditing(null);
    setCompleteMode(false);
    setVehiclePlate('');
    setOutDate(getWibDateString());
    setKmOut('');
    setFinishDate('');
    setKmBack('');
    setInsuranceType('non_asuransi');
    setWorkshopName('');
    setNotes('');
    setFormError(null);
    setModalOpen(true);
  };

  const openEdit = (item: WorkshopLog, isCompleteAction = false) => {
    setEditing(item);
    setCompleteMode(isCompleteAction);
    setVehiclePlate(item.vehicle_plate);
    setOutDate(item.out_date);
    setKmOut(String(item.km_out));
    setFinishDate(item.finish_date ?? (isCompleteAction ? getWibDateString() : ''));
    setKmBack(item.km_back !== null ? String(item.km_back) : '');
    setInsuranceType(item.insurance_type);
    setWorkshopName(item.workshop_name);
    setNotes(item.notes ?? '');
    setFormError(null);
    setModalOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    const parsed = workshopLogSchema.safeParse({
      vehicle_plate: vehiclePlate,
      out_date: outDate,
      km_out: kmOut,
      finish_date: finishDate || null,
      km_back: kmBack === '' ? null : Number(kmBack),
      workshop_name: workshopName,
      insurance_type: insuranceType,
      notes: notes || null,
    });

    if (!parsed.success) {
      setFormError(parsed.error.errors[0]?.message ?? 'Input tidak valid.');
      return;
    }

    setSaving(true);
    try {
      const res = await fetch('/api/mutasi/bengkel', {
        method: editing ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editing ? { id: editing.id, ...parsed.data } : parsed.data),
      });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) {
        setFormError(json.error ?? 'Gagal menyimpan data bengkel.');
        return;
      }
      toast.success(editing ? 'Mutasi bengkel diperbarui.' : 'Mutasi bengkel dicatat.');
      setModalOpen(false);
      await loadData();
    } catch {
      toast.error('Gagal terhubung ke server.');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/mutasi/bengkel?id=${deleteTarget.id}`, { method: 'DELETE' });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) {
        toast.error(json.error ?? 'Gagal menghapus data.');
        return;
      }
      toast.success('Data bengkel dihapus.');
      setDeleteTarget(null);
      await loadData();
    } catch {
      toast.error('Gagal terhubung ke server.');
    } finally {
      setDeleting(false);
    }
  };

  const handleExport = () => {
    const headers = [
      'Nomor Polisi',
      'Tanggal Keluar',
      'KM Keluar Kantor',
      'Tanggal Selesai',
      'KM Kembali Kantor',
      'TOTAL KM',
      'Lama Pengerjaan (Hari)',
      'Bengkel (Non Asuransi)',
      'Bengkel (Asuransi)',
      'Catatan/Keterangan Lain-lain',
    ];
    const rows = filtered.map((item) => ({
      'Nomor Polisi': item.vehicle_plate,
      'Tanggal Keluar': item.out_date,
      'KM Keluar Kantor': item.km_out,
      'Tanggal Selesai': item.finish_date ?? '',
      'KM Kembali Kantor': item.km_back ?? '',
      'TOTAL KM': item.total_km ?? '',
      'Lama Pengerjaan (Hari)': item.repair_days ?? '',
      'Bengkel (Non Asuransi)': item.insurance_type === 'non_asuransi' ? item.workshop_name : '',
      'Bengkel (Asuransi)': item.insurance_type === 'asuransi' ? item.workshop_name : '',
      'Catatan/Keterangan Lain-lain': item.notes ?? '',
    }));
    exportRowsToExcel('Mutasi_Bengkel.xlsx', 'Mutasi Bengkel-admin', rows, headers);
    toast.success('Export Mutasi Bengkel berhasil.');
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-extrabold text-ink">Mutasi Bengkel</h1>
          <p className="text-sm text-ink-muted mt-0.5">
            Monitor kendaraan keluar masuk bengkel dengan perhitungan otomatis Total KM dan Lama Pengerjaan.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            onClick={handleExport}
            disabled={filtered.length === 0}
            className="inline-flex items-center gap-2 rounded-xl border border-border-sky bg-white hover:bg-page disabled:opacity-50 px-4 py-2.5 text-sm font-semibold text-ink shadow-sm transition"
          >
            <Download className="w-4 h-4 text-primary-600" />
            <span>Export Excel</span>
          </button>
          <button
            type="button"
            onClick={openCreate}
            className="inline-flex items-center gap-2 rounded-xl bg-primary-600 hover:bg-primary-700 text-white px-4 py-2.5 text-sm font-semibold shadow-soft transition"
          >
            <Plus className="w-4 h-4" />
            <span>Catat Unit ke Bengkel</span>
          </button>
        </div>
      </div>

      <div className="rounded-2xl bg-surface border border-border-sky shadow-soft overflow-hidden">
        <div className="p-4 border-b border-border-sky flex flex-wrap items-center justify-between gap-3">
          <div className="relative flex-1 min-w-[220px] max-w-md">
            <Search className="w-4 h-4 text-ink-muted absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Cari nopol, nama bengkel, catatan..."
              className="w-full rounded-xl border border-border-sky bg-page/50 pl-10 pr-4 py-2.5 text-sm focus:border-primary-600 focus:bg-white focus:outline-none"
            />
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <Calendar className="w-4 h-4 text-ink-muted" />
            <input
              type="date"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
              className="rounded-xl border border-border-sky bg-white px-3 py-2 text-xs text-ink focus:border-primary-600 focus:outline-none"
            />
            <span className="text-ink-muted">s/d</span>
            <input
              type="date"
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
              className="rounded-xl border border-border-sky bg-white px-3 py-2 text-xs text-ink focus:border-primary-600 focus:outline-none"
            />
            {(fromDate || toDate) && (
              <button
                type="button"
                onClick={() => {
                  setFromDate('');
                  setToDate('');
                }}
                className="rounded-xl bg-page px-3 py-2 font-semibold text-ink-muted hover:text-ink"
              >
                Reset
              </button>
            )}
          </div>
        </div>

        {loading ? (
          <TableSkeleton rows={5} cols={9} />
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={Wrench}
            title="Belum ada data mutasi bengkel"
            description="Catat kendaraan yang masuk perawatan bengkel di sini."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead className="bg-primary-50 text-ink font-bold text-xs uppercase tracking-wider">
                <tr>
                  <th className="px-4 py-3">Nopol</th>
                  <th className="px-4 py-3">
                    <button
                      type="button"
                      onClick={() => setSortAsc((p) => !p)}
                      className="inline-flex items-center gap-1 hover:text-primary-700"
                    >
                      <span>Tgl Keluar</span>
                      <ArrowUpDown className="w-3.5 h-3.5 opacity-60" />
                    </button>
                  </th>
                  <th className="px-4 py-3">KM Keluar</th>
                  <th className="px-4 py-3">Tgl Selesai</th>
                  <th className="px-4 py-3">KM Kembali</th>
                  <th className="px-4 py-3">Total KM</th>
                  <th className="px-4 py-3">Lama (Hari)</th>
                  <th className="px-4 py-3">Bengkel & Jenis</th>
                  <th className="px-4 py-3">Catatan</th>
                  <th className="px-4 py-3 text-right">Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-sky">
                {paginated.map((item) => {
                  const isOpen = !item.finish_date || item.km_back === null;
                  return (
                    <tr key={item.id} className="hover:bg-page/50">
                      <td className="px-4 py-3 font-bold text-ink whitespace-nowrap">
                        {item.vehicle_plate}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        {formatWibDateOnlyLabel(item.out_date)}
                      </td>
                      <td className="px-4 py-3 tabular-nums">
                        {item.km_out.toLocaleString('id-ID')}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        {item.finish_date ? (
                          formatWibDateOnlyLabel(item.finish_date)
                        ) : (
                          <span className="inline-flex rounded-full bg-amber-100 text-amber-800 px-2.5 py-0.5 text-xs font-semibold">
                            Masih di bengkel
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 tabular-nums">
                        {item.km_back !== null ? item.km_back.toLocaleString('id-ID') : '-'}
                      </td>
                      <td className="px-4 py-3 tabular-nums font-bold text-primary-700">
                        {item.total_km !== null ? `${item.total_km.toLocaleString('id-ID')} km` : '-'}
                      </td>
                      <td className="px-4 py-3 tabular-nums font-semibold">
                        {item.repair_days !== null ? `${item.repair_days} hari` : '-'}
                      </td>
                      <td className="px-4 py-3">
                        <div className="font-semibold text-ink">{item.workshop_name}</div>
                        <span
                          className={`inline-flex rounded-md px-2 py-0.5 text-[11px] font-bold mt-0.5 ${
                            item.insurance_type === 'asuransi'
                              ? 'bg-indigo-100 text-indigo-700'
                              : 'bg-sky-100 text-sky-700'
                          }`}
                        >
                          {item.insurance_type === 'asuransi' ? 'Asuransi' : 'Non Asuransi'}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-ink-muted max-w-[180px] truncate">
                        {item.notes || '-'}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-1">
                          {isOpen && (
                            <button
                              type="button"
                              onClick={() => openEdit(item, true)}
                              className="inline-flex items-center gap-1 rounded-lg bg-emerald-100 text-emerald-800 hover:bg-emerald-200 px-2.5 py-1.5 text-xs font-semibold mr-1 transition"
                              title="Lengkapi data kembali"
                            >
                              <CheckCircle2 className="w-3.5 h-3.5" />
                              <span className="hidden xl:inline">Lengkapi data kembali</span>
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => openEdit(item, false)}
                            className="p-2 rounded-lg text-ink-muted hover:bg-primary-50 hover:text-primary-700"
                            title="Edit"
                          >
                            <Edit3 className="w-4 h-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => setDeleteTarget(item)}
                            className="p-2 rounded-lg text-ink-muted hover:bg-danger/10 hover:text-danger"
                            title="Hapus"
                          >
                            <Trash2 className="w-4 h-4" />
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

        <DataTablePagination
          totalItems={filtered.length}
          page={page}
          pageSize={pageSize}
          onPageChange={setPage}
          onPageSizeChange={setPageSize}
        />
      </div>

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={
          completeMode
            ? 'Lengkapi Data Kembali dari Bengkel'
            : editing
              ? 'Edit Mutasi Bengkel'
              : 'Catat Kendaraan Masuk Bengkel'
        }
        maxWidthClass="max-w-2xl"
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          {formError && (
            <div className="rounded-xl bg-danger/10 border border-danger/30 px-4 py-2.5 text-xs font-semibold text-danger">
              {formError}
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-semibold text-ink mb-1">Nomor Polisi *</label>
              <AutocompleteInput
                options={plateOptions}
                value={vehiclePlate}
                onChange={(val) => setVehiclePlate(val)}
                placeholder="Pilih atau ketik nopol"
                allowFreeText
                uppercase
                badgeForFreeText="Nopol belum terdaftar di master"
              />
            </div>

            <div>
              <label className="block text-sm font-semibold text-ink mb-1">Jenis Bengkel *</label>
              <div className="grid grid-cols-2 gap-2 p-1 rounded-xl bg-page border border-border-sky">
                {[
                  { value: 'non_asuransi' as const, label: 'Non Asuransi' },
                  { value: 'asuransi' as const, label: 'Asuransi' },
                ].map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setInsuranceType(opt.value)}
                    className={`rounded-lg py-2 text-xs font-bold transition ${
                      insuranceType === opt.value
                        ? 'bg-primary-600 text-white shadow-sm'
                        : 'text-ink-muted hover:text-ink'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div>
            <label className="block text-sm font-semibold text-ink mb-1">Nama Bengkel *</label>
            <AutocompleteInput
              options={workshopOptions}
              value={workshopName}
              onChange={(val) => setWorkshopName(val)}
              placeholder="Ketik nama bengkel (saran dari master)"
              allowFreeText
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-semibold text-ink mb-1">Tanggal Keluar *</label>
              <input
                type="date"
                value={outDate}
                onChange={(e) => setOutDate(e.target.value)}
                className="w-full rounded-xl border border-border-sky px-3.5 py-2.5 text-sm focus:border-primary-600 focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-sm font-semibold text-ink mb-1">KM Keluar Kantor *</label>
              <input
                type="number"
                min={0}
                value={kmOut}
                onChange={(e) => setKmOut(e.target.value)}
                placeholder="Contoh: 125400"
                className="w-full rounded-xl border border-border-sky px-3.5 py-2.5 text-sm focus:border-primary-600 focus:outline-none"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-semibold text-ink mb-1">Tanggal Selesai</label>
              <input
                type="date"
                value={finishDate}
                onChange={(e) => setFinishDate(e.target.value)}
                className="w-full rounded-xl border border-border-sky px-3.5 py-2.5 text-sm focus:border-primary-600 focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-sm font-semibold text-ink mb-1">KM Kembali Kantor</label>
              <input
                type="number"
                min={0}
                value={kmBack}
                onChange={(e) => setKmBack(e.target.value)}
                placeholder="Isi saat unit selesai"
                className="w-full rounded-xl border border-border-sky px-3.5 py-2.5 text-sm focus:border-primary-600 focus:outline-none"
              />
            </div>
          </div>

          {/* Read-only automatic calculation preview */}
          <div className="grid grid-cols-2 gap-3 rounded-xl bg-primary-50 border border-border-sky p-3.5">
            <div>
              <div className="text-xs font-semibold text-ink-muted">TOTAL KM (Otomatis)</div>
              <div className="text-lg font-extrabold text-primary-700 tabular-nums">
                {previewTotalKm !== null ? `${previewTotalKm.toLocaleString('id-ID')} km` : '-'}
              </div>
            </div>
            <div>
              <div className="text-xs font-semibold text-ink-muted">Lama Pengerjaan (Otomatis)</div>
              <div className="text-lg font-extrabold text-primary-700 tabular-nums">
                {previewRepairDays !== null ? `${previewRepairDays} hari` : '-'}
              </div>
            </div>
          </div>

          <div>
            <label className="block text-sm font-semibold text-ink mb-1">
              Catatan / Keterangan Lain-lain
            </label>
            <textarea
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Detail servis atau perbaikan (opsional)"
              className="w-full rounded-xl border border-border-sky px-3.5 py-2.5 text-sm focus:border-primary-600 focus:outline-none"
            />
          </div>

          <div className="flex items-center justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={() => setModalOpen(false)}
              className="rounded-xl border border-border-sky bg-white px-4 py-2.5 text-sm font-semibold text-ink hover:bg-page"
            >
              Batal
            </button>
            <button
              type="submit"
              disabled={saving}
              className="rounded-xl bg-primary-600 hover:bg-primary-700 disabled:opacity-60 text-white px-5 py-2.5 text-sm font-semibold flex items-center gap-2"
            >
              {saving && <Loader2 className="w-4 h-4 animate-spin" />}
              <span>Simpan</span>
            </button>
          </div>
        </form>
      </Modal>

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleDelete}
        loading={deleting}
        title="Hapus Data Bengkel?"
        message={`Hapus catatan bengkel untuk unit "${deleteTarget?.vehicle_plate ?? ''}"?`}
        confirmLabel="Hapus"
      />
    </div>
  );
}

