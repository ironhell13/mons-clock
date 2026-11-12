'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowDownLeft,
  ArrowUpDown,
  ArrowUpRight,
  Calendar,
  Download,
  Edit3,
  Loader2,
  Package,
  Plus,
  Search,
  Trash2,
} from 'lucide-react';
import { toast } from 'sonner';
import type { GoodsDirection, GoodsLog } from '@/types/database';
import { formatWibDateOnlyLabel, getWibDateString } from '@/lib/time';
import { exportRowsToExcel } from '@/lib/excel';
import { goodsLogSchema } from '@/lib/validators';
import { Modal } from '@/components/ui/Modal';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { EmptyState } from '@/components/ui/EmptyState';
import { TableSkeleton } from '@/components/ui/Skeleton';
import { DataTablePagination } from '@/components/ui/DataTablePagination';

function hhmm(val: string | null | undefined): string {
  if (!val) return '';
  return val.slice(0, 5);
}

export function MutasiBarangClient() {
  const [items, setItems] = useState<GoodsLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [sortAsc, setSortAsc] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<GoodsLog | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<GoodsLog | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const [direction, setDirection] = useState<GoodsDirection>('masuk');
  const [logDate, setLogDate] = useState(getWibDateString());
  const [timeIn, setTimeIn] = useState('');
  const [timeOut, setTimeOut] = useState('');
  const [name, setName] = useState('');
  const [vehiclePlate, setVehiclePlate] = useState('');
  const [itemName, setItemName] = useState('');
  const [itemQty, setItemQty] = useState('1');
  const [notes, setNotes] = useState('');

  const timeInRef = useRef<HTMLInputElement>(null);
  const timeOutRef = useRef<HTMLInputElement>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (fromDate) params.set('from', fromDate);
      if (toDate) params.set('to', toDate);
      const res = await fetch(`/api/mutasi/barang?${params.toString()}`, { cache: 'no-store' });
      const json = (await res.json()) as { items?: GoodsLog[]; error?: string };
      if (!res.ok) {
        toast.error(json.error ?? 'Gagal memuat data mutasi barang.');
        return;
      }
      setItems(json.items ?? []);
    } catch {
      toast.error('Gagal terhubung ke server.');
    } finally {
      setLoading(false);
    }
  }, [fromDate, toDate]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = items.filter((i) => {
      if (!q) return true;
      return [i.name, i.vehicle_plate, i.item_name, i.notes, i.direction]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q));
    });
    return [...list].sort((a, b) =>
      sortAsc ? a.log_date.localeCompare(b.log_date) : b.log_date.localeCompare(a.log_date)
    );
  }, [items, search, sortAsc]);

  const paginated = useMemo(() => {
    const start = (page - 1) * pageSize;
    return filtered.slice(start, start + pageSize);
  }, [filtered, page, pageSize]);

  useEffect(() => {
    setPage(1);
  }, [search, fromDate, toDate]);

  const handleDirectionSelect = (nextDir: GoodsDirection) => {
    setDirection(nextDir);
    setTimeout(() => {
      if (nextDir === 'masuk') {
        timeInRef.current?.focus();
      } else {
        timeOutRef.current?.focus();
      }
    }, 30);
  };

  const openCreate = () => {
    const wibHm = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Jakarta',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(new Date());

    setEditing(null);
    setDirection('masuk');
    setLogDate(getWibDateString());
    setTimeIn(wibHm);
    setTimeOut('');
    setName('');
    setVehiclePlate('');
    setItemName('');
    setItemQty('1');
    setNotes('');
    setFormError(null);
    setModalOpen(true);
    setTimeout(() => timeInRef.current?.focus(), 80);
  };

  const openEdit = (item: GoodsLog) => {
    setEditing(item);
    setDirection(item.direction);
    setLogDate(item.log_date);
    setTimeIn(hhmm(item.time_in));
    setTimeOut(hhmm(item.time_out));
    setName(item.name);
    setVehiclePlate(item.vehicle_plate ?? '');
    setItemName(item.item_name);
    setItemQty(String(item.item_qty));
    setNotes(item.notes ?? '');
    setFormError(null);
    setModalOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    const parsed = goodsLogSchema.safeParse({
      direction,
      log_date: logDate,
      time_in: timeIn || null,
      time_out: timeOut || null,
      name,
      vehicle_plate: vehiclePlate || null,
      item_name: itemName,
      item_qty: itemQty,
      notes: notes || null,
    });

    if (!parsed.success) {
      setFormError(parsed.error.errors[0]?.message ?? 'Input tidak valid.');
      return;
    }

    setSaving(true);
    try {
      const res = await fetch('/api/mutasi/barang', {
        method: editing ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editing ? { id: editing.id, ...parsed.data } : parsed.data),
      });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) {
        setFormError(json.error ?? 'Gagal menyimpan mutasi barang.');
        return;
      }
      toast.success(editing ? 'Mutasi barang diperbarui.' : 'Mutasi barang dicatat.');
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
      const res = await fetch(`/api/mutasi/barang?id=${deleteTarget.id}`, { method: 'DELETE' });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) {
        toast.error(json.error ?? 'Gagal menghapus data.');
        return;
      }
      toast.success('Data mutasi barang dihapus.');
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
      'KELUAR/MASUK',
      'Tanggal',
      'MASUK',
      'KELUAR',
      'NAMA',
      'NOPOL',
      'NAMA BARANG',
      'JUMLAH BARANG',
      'KETERANGAN',
    ];
    const rows = filtered.map((item) => ({
      'KELUAR/MASUK': item.direction === 'masuk' ? 'MASUK' : 'KELUAR',
      Tanggal: item.log_date,
      MASUK: hhmm(item.time_in),
      KELUAR: hhmm(item.time_out),
      NAMA: item.name,
      NOPOL: item.vehicle_plate ?? '',
      'NAMA BARANG': item.item_name,
      'JUMLAH BARANG': item.item_qty,
      KETERANGAN: item.notes ?? '',
    }));
    exportRowsToExcel('Mutasi_Barang.xlsx', 'Mutasi Barang-admin', rows, headers);
    toast.success('Export Mutasi Barang berhasil.');
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-extrabold text-ink">Mutasi Barang</h1>
          <p className="text-sm text-ink-muted mt-0.5">
            Pencatatan keluar-masuk barang dan logistik operasional pos security.
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
            <span>Catat Barang</span>
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
              placeholder="Cari nama pembawa, barang, nopol..."
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
          <TableSkeleton rows={5} cols={8} />
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={Package}
            title="Belum ada data mutasi barang"
            description="Klik Catat Barang untuk mencatat keluar-masuk logistik."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead className="bg-primary-50 text-ink font-bold text-xs uppercase tracking-wider">
                <tr>
                  <th className="px-4 py-3">Jenis</th>
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
                  <th className="px-4 py-3">Nopol</th>
                  <th className="px-4 py-3">Nama Barang</th>
                  <th className="px-4 py-3">Jumlah</th>
                  <th className="px-4 py-3">Keterangan</th>
                  <th className="px-4 py-3 text-right">Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-sky">
                {paginated.map((item) => (
                  <tr key={item.id} className="hover:bg-page/50">
                    <td className="px-4 py-3">
                      {item.direction === 'masuk' ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 text-emerald-800 px-2.5 py-0.5 text-xs font-bold">
                          <ArrowDownLeft className="w-3.5 h-3.5" />
                          Masuk
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 text-amber-800 px-2.5 py-0.5 text-xs font-bold">
                          <ArrowUpRight className="w-3.5 h-3.5" />
                          Keluar
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      {formatWibDateOnlyLabel(item.log_date)}
                    </td>
                    <td className="px-4 py-3 tabular-nums">{hhmm(item.time_in) || '-'}</td>
                    <td className="px-4 py-3 tabular-nums">{hhmm(item.time_out) || '-'}</td>
                    <td className="px-4 py-3 font-semibold text-ink">{item.name}</td>
                    <td className="px-4 py-3 font-bold text-ink">{item.vehicle_plate || '-'}</td>
                    <td className="px-4 py-3 font-medium text-ink">{item.item_name}</td>
                    <td className="px-4 py-3 tabular-nums font-bold text-primary-700">
                      {item.item_qty}
                    </td>
                    <td className="px-4 py-3 text-ink-muted max-w-[160px] truncate">
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
        title={editing ? 'Edit Mutasi Barang' : 'Catat Mutasi Barang'}
        maxWidthClass="max-w-xl"
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          {formError && (
            <div className="rounded-xl bg-danger/10 border border-danger/30 px-4 py-2.5 text-xs font-semibold text-danger">
              {formError}
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-semibold text-ink mb-1">Keluar / Masuk *</label>
              <div className="grid grid-cols-2 gap-2 p-1 rounded-xl bg-page border border-border-sky">
                {[
                  { value: 'masuk' as const, label: 'Masuk' },
                  { value: 'keluar' as const, label: 'Keluar' },
                ].map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => handleDirectionSelect(opt.value)}
                    className={`rounded-lg py-2 text-xs font-bold transition ${
                      direction === opt.value
                        ? 'bg-primary-600 text-white shadow-sm'
                        : 'text-ink-muted hover:text-ink'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-sm font-semibold text-ink mb-1">Tanggal *</label>
              <input
                type="date"
                value={logDate}
                onChange={(e) => setLogDate(e.target.value)}
                className="w-full rounded-xl border border-border-sky px-3.5 py-2.5 text-sm focus:border-primary-600 focus:outline-none"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-semibold text-ink mb-1">
                Jam Masuk {direction === 'masuk' && <span className="text-primary-600">(Fokus)</span>}
              </label>
              <input
                ref={timeInRef}
                type="time"
                value={timeIn}
                onChange={(e) => setTimeIn(e.target.value)}
                className={`w-full rounded-xl border px-3.5 py-2.5 text-sm focus:outline-none ${
                  direction === 'masuk'
                    ? 'border-primary-500 ring-2 ring-primary/20 bg-primary-50/40'
                    : 'border-border-sky'
                }`}
              />
            </div>
            <div>
              <label className="block text-sm font-semibold text-ink mb-1">
                Jam Keluar{' '}
                {direction === 'keluar' && <span className="text-primary-600">(Fokus)</span>}
              </label>
              <input
                ref={timeOutRef}
                type="time"
                value={timeOut}
                onChange={(e) => setTimeOut(e.target.value)}
                className={`w-full rounded-xl border px-3.5 py-2.5 text-sm focus:outline-none ${
                  direction === 'keluar'
                    ? 'border-primary-500 ring-2 ring-primary/20 bg-primary-50/40'
                    : 'border-border-sky'
                }`}
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-semibold text-ink mb-1">Nama Pembawa *</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Nama petugas / kurir"
                className="w-full rounded-xl border border-border-sky px-3.5 py-2.5 text-sm focus:border-primary-600 focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-sm font-semibold text-ink mb-1">
                Nopol (Bebas / Pribadi)
              </label>
              <input
                type="text"
                value={vehiclePlate}
                onChange={(e) => setVehiclePlate(e.target.value.toUpperCase())}
                placeholder="Opsional (contoh: B 1234 XYZ)"
                className="w-full rounded-xl border border-border-sky px-3.5 py-2.5 text-sm uppercase font-bold tracking-wide focus:border-primary-600 focus:outline-none"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="sm:col-span-2">
              <label className="block text-sm font-semibold text-ink mb-1">Nama Barang *</label>
              <input
                type="text"
                value={itemName}
                onChange={(e) => setItemName(e.target.value)}
                placeholder="Contoh: Kertas Struk ATM / Kaset"
                className="w-full rounded-xl border border-border-sky px-3.5 py-2.5 text-sm focus:border-primary-600 focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-sm font-semibold text-ink mb-1">Jumlah *</label>
              <input
                type="number"
                min={1}
                value={itemQty}
                onChange={(e) => setItemQty(e.target.value)}
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
        title="Hapus Mutasi Barang?"
        message={`Hapus catatan barang "${deleteTarget?.item_name ?? ''}"?`}
        confirmLabel="Hapus"
      />
    </div>
  );
}

