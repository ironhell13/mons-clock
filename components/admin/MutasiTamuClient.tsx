'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowUpDown,
  Calendar,
  Clock,
  Download,
  Edit3,
  Loader2,
  Plus,
  Search,
  Trash2,
  UserCheck,
} from 'lucide-react';
import { toast } from 'sonner';
import type { GuestLog } from '@/types/database';
import { formatWibDateOnlyLabel, getWibDateString } from '@/lib/time';
import { exportRowsToExcel } from '@/lib/excel';
import { guestLogSchema } from '@/lib/validators';
import { Modal } from '@/components/ui/Modal';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { EmptyState } from '@/components/ui/EmptyState';
import { TableSkeleton } from '@/components/ui/Skeleton';
import { DataTablePagination } from '@/components/ui/DataTablePagination';
import { AutocompleteInput } from '@/components/ui/AutocompleteInput';

function hhmm(val: string | null | undefined): string {
  if (!val) return '';
  return val.slice(0, 5);
}

export function MutasiTamuClient() {
  const [items, setItems] = useState<GuestLog[]>([]);
  const [plates, setPlates] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [sortAsc, setSortAsc] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<GuestLog | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<GuestLog | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const [logDate, setLogDate] = useState(getWibDateString());
  const [timeIn, setTimeIn] = useState('08:00');
  const [timeOut, setTimeOut] = useState('');
  const [name, setName] = useState('');
  const [vehiclePlate, setVehiclePlate] = useState('');
  const [origin, setOrigin] = useState('');
  const [notes, setNotes] = useState('');

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (fromDate) params.set('from', fromDate);
      if (toDate) params.set('to', toDate);
      const res = await fetch(`/api/mutasi/tamu?${params.toString()}`, { cache: 'no-store' });
      const json = (await res.json()) as { items?: GuestLog[]; plates?: string[]; error?: string };
      if (!res.ok) {
        toast.error(json.error ?? 'Gagal memuat data mutasi tamu.');
        return;
      }
      setItems(json.items ?? []);
      setPlates(json.plates ?? []);
    } catch {
      toast.error('Gagal terhubung ke server.');
    } finally {
      setLoading(false);
    }
  }, [fromDate, toDate]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const plateOptions = useMemo(
    () => plates.map((p) => ({ value: p, label: p })),
    [plates]
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = items.filter((i) => {
      if (!q) return true;
      return [i.name, i.vehicle_plate, i.origin, i.notes]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q));
    });
    return [...list].sort((a, b) => {
      const da = `${a.log_date} ${a.time_in}`;
      const db = `${b.log_date} ${b.time_in}`;
      return sortAsc ? da.localeCompare(db) : db.localeCompare(da);
    });
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
    setLogDate(getWibDateString());
    const now = new Date();
    const wibHm = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Jakarta',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(now);
    setTimeIn(wibHm);
    setTimeOut('');
    setName('');
    setVehiclePlate('');
    setOrigin('');
    setNotes('');
    setFormError(null);
    setModalOpen(true);
  };

  const openEdit = (item: GuestLog, focusCheckout = false) => {
    setEditing(item);
    setLogDate(item.log_date);
    setTimeIn(hhmm(item.time_in));
    if (focusCheckout && !item.time_out) {
      const now = new Date();
      setTimeOut(
        new Intl.DateTimeFormat('en-GB', {
          timeZone: 'Asia/Jakarta',
          hour: '2-digit',
          minute: '2-digit',
          hour12: false,
        }).format(now)
      );
    } else {
      setTimeOut(hhmm(item.time_out));
    }
    setName(item.name);
    setVehiclePlate(item.vehicle_plate ?? '');
    setOrigin(item.origin);
    setNotes(item.notes ?? '');
    setFormError(null);
    setModalOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    const parsed = guestLogSchema.safeParse({
      log_date: logDate,
      time_in: timeIn,
      time_out: timeOut || null,
      name,
      vehicle_plate: vehiclePlate || null,
      origin,
      notes: notes || null,
    });

    if (!parsed.success) {
      setFormError(parsed.error.errors[0]?.message ?? 'Data tidak valid.');
      return;
    }

    setSaving(true);
    try {
      const res = await fetch('/api/mutasi/tamu', {
        method: editing ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editing ? { id: editing.id, ...parsed.data } : parsed.data),
      });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) {
        setFormError(json.error ?? 'Gagal menyimpan mutasi tamu.');
        return;
      }
      toast.success(editing ? 'Data tamu diperbarui.' : 'Mutasi tamu dicatat.');
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
      const res = await fetch(`/api/mutasi/tamu?id=${deleteTarget.id}`, { method: 'DELETE' });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) {
        toast.error(json.error ?? 'Gagal menghapus data.');
        return;
      }
      toast.success('Data tamu dihapus.');
      setDeleteTarget(null);
      await loadData();
    } catch {
      toast.error('Gagal terhubung ke server.');
    } finally {
      setDeleting(false);
    }
  };

  const handleExport = () => {
    const headers = ['Tanggal', 'MASUK', 'KELUAR', 'NAMA', 'PLAT KENDARAAN', 'DARI', 'KETERANGAN'];
    const rows = filtered.map((item) => ({
      Tanggal: item.log_date,
      MASUK: hhmm(item.time_in),
      KELUAR: hhmm(item.time_out),
      NAMA: item.name,
      'PLAT KENDARAAN': item.vehicle_plate ?? '',
      DARI: item.origin,
      KETERANGAN: item.notes ?? '',
    }));
    exportRowsToExcel('Mutasi_Tamu.xlsx', 'Mutasi Tamu-admin', rows, headers);
    toast.success('Export Mutasi Tamu berhasil.');
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-extrabold text-ink">Mutasi Tamu</h1>
          <p className="text-sm text-ink-muted mt-0.5">
            Pencatatan kedatangan dan kepulangan tamu di pos security.
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
            <span>Tambah Tamu</span>
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
              placeholder="Cari nama tamu, plat, instansi..."
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
          <TableSkeleton rows={5} cols={7} />
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={UserCheck}
            title="Belum ada data mutasi tamu"
            description="Klik Tambah Tamu untuk mencatat kunjungan baru."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead className="bg-primary-50 text-ink font-bold text-xs uppercase tracking-wider">
                <tr>
                  <th className="px-4 py-3">
                    <button
                      type="button"
                      onClick={() => setSortAsc((p) => !p)}
                      className="inline-flex items-center gap-1 hover:text-primary-700"
                    >
                      <span>Tanggal</span>
                      <ArrowUpDown className="w-3.5 h-3.5 opacity-60" />
                    </button>
                  </th>
                  <th className="px-4 py-3">Masuk</th>
                  <th className="px-4 py-3">Keluar</th>
                  <th className="px-4 py-3">Nama</th>
                  <th className="px-4 py-3">Plat Kendaraan</th>
                  <th className="px-4 py-3">Dari</th>
                  <th className="px-4 py-3">Keterangan</th>
                  <th className="px-4 py-3 text-right">Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-sky">
                {paginated.map((item) => (
                  <tr key={item.id} className="hover:bg-page/50">
                    <td className="px-4 py-3 whitespace-nowrap font-medium">
                      {formatWibDateOnlyLabel(item.log_date)}
                    </td>
                    <td className="px-4 py-3 tabular-nums font-semibold text-emerald-700">
                      {hhmm(item.time_in)}
                    </td>
                    <td className="px-4 py-3 tabular-nums">
                      {item.time_out ? (
                        <span className="font-semibold text-ink">{hhmm(item.time_out)}</span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => openEdit(item, true)}
                          className="inline-flex items-center gap-1 rounded-lg bg-amber-100 text-amber-800 hover:bg-amber-200 px-2.5 py-1 text-xs font-semibold transition"
                        >
                          <Clock className="w-3 h-3" />
                          Catat Keluar
                        </button>
                      )}
                    </td>
                    <td className="px-4 py-3 font-semibold text-ink">{item.name}</td>
                    <td className="px-4 py-3 font-bold text-ink">{item.vehicle_plate || '-'}</td>
                    <td className="px-4 py-3 text-ink-muted">{item.origin}</td>
                    <td className="px-4 py-3 text-ink-muted max-w-xs truncate">
                      {item.notes || '-'}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          type="button"
                          onClick={() => openEdit(item)}
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

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editing ? 'Edit Mutasi Tamu' : 'Catat Tamu Baru'}
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          {formError && (
            <div className="rounded-xl bg-danger/10 border border-danger/30 px-4 py-2.5 text-xs font-semibold text-danger">
              {formError}
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="block text-sm font-semibold text-ink mb-1">Tanggal *</label>
              <input
                type="date"
                value={logDate}
                onChange={(e) => setLogDate(e.target.value)}
                className="w-full rounded-xl border border-border-sky px-3 py-2.5 text-sm focus:border-primary-600 focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-sm font-semibold text-ink mb-1">Jam Masuk *</label>
              <input
                type="time"
                value={timeIn}
                onChange={(e) => setTimeIn(e.target.value)}
                className="w-full rounded-xl border border-border-sky px-3 py-2.5 text-sm focus:border-primary-600 focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-sm font-semibold text-ink mb-1">Jam Keluar</label>
              <input
                type="time"
                value={timeOut}
                onChange={(e) => setTimeOut(e.target.value)}
                className="w-full rounded-xl border border-border-sky px-3 py-2.5 text-sm focus:border-primary-600 focus:outline-none"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-semibold text-ink mb-1">Nama Tamu *</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Nama lengkap tamu"
              className="w-full rounded-xl border border-border-sky px-3.5 py-2.5 text-sm focus:border-primary-600 focus:outline-none"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-semibold text-ink mb-1">Plat Kendaraan</label>
              <AutocompleteInput
                options={plateOptions}
                value={vehiclePlate}
                onChange={(val) => setVehiclePlate(val)}
                placeholder="Contoh: B 1234 ABC"
                allowFreeText
                uppercase
              />
            </div>
            <div>
              <label className="block text-sm font-semibold text-ink mb-1">Dari / Instansi *</label>
              <input
                type="text"
                value={origin}
                onChange={(e) => setOrigin(e.target.value)}
                placeholder="Asal perusahaan / keperluan"
                className="w-full rounded-xl border border-border-sky px-3.5 py-2.5 text-sm focus:border-primary-600 focus:outline-none"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-semibold text-ink mb-1">Keterangan</label>
            <textarea
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Catatan tambahan (opsional)"
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
        title="Hapus Data Tamu?"
        message={`Hapus catatan tamu "${deleteTarget?.name ?? ''}"?`}
        confirmLabel="Hapus"
      />
    </div>
  );
}

