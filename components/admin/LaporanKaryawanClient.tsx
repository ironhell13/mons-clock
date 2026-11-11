'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowUpDown,
  Calendar,
  ClipboardList,
  Download,
  Edit3,
  History,
  Loader2,
  Plus,
  Search,
  Trash2,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  formatWibDateTime,
  formatWibDateTimeExcel,
  fromWibDatetimeLocal,
  getWibDateString,
  toWibDatetimeLocal,
} from '@/lib/time';
import { exportRowsToExcel } from '@/lib/excel';
import { Modal } from '@/components/ui/Modal';
import { EmptyState } from '@/components/ui/EmptyState';
import { TableSkeleton } from '@/components/ui/Skeleton';
import { DataTablePagination } from '@/components/ui/DataTablePagination';
import {
  AuditLogsModal,
  DeleteLaporanModal,
  type LaporanAuditItem,
} from '@/components/admin/LaporanActionModals';

interface AttendanceRow {
  id: string;
  employee_id: string;
  work_date: string;
  masuk_at: string | null;
  istirahat_at: string | null;
  pulang_at: string | null;
  employee: { id: string; name: string; position: string; employee_no: string } | null;
}

interface EmployeeOption {
  id: string;
  name: string;
  position: string;
  employee_no: string;
}

export function LaporanKaryawanClient() {
  const [items, setItems] = useState<AttendanceRow[]>([]);
  const [employees, setEmployees] = useState<EmployeeOption[]>([]);
  const [auditLogs, setAuditLogs] = useState<LaporanAuditItem[]>([]);
  const [loading, setLoading] = useState(true);

  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [employeeFilter, setEmployeeFilter] = useState('');
  const [search, setSearch] = useState('');
  const [sortAsc, setSortAsc] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(15);

  const [auditOpen, setAuditOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<AttendanceRow | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [editing, setEditing] = useState<AttendanceRow | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [corrEmployeeId, setCorrEmployeeId] = useState('');
  const [corrWorkDate, setCorrWorkDate] = useState(getWibDateString());
  const [corrMasuk, setCorrMasuk] = useState('');
  const [corrIstirahat, setCorrIstirahat] = useState('');
  const [corrPulang, setCorrPulang] = useState('');
  const [corrReason, setCorrReason] = useState('');
  const [saving, setSaving] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ kind: 'karyawan' });
      if (fromDate) params.set('from', fromDate);
      if (toDate) params.set('to', toDate);
      if (employeeFilter) params.set('employee_id', employeeFilter);
      const res = await fetch(`/api/laporan?${params.toString()}`, { cache: 'no-store' });
      const json = (await res.json()) as {
        items?: AttendanceRow[];
        employees?: EmployeeOption[];
        auditLogs?: LaporanAuditItem[];
        error?: string;
      };
      if (!res.ok) {
        toast.error(json.error ?? 'Gagal memuat laporan karyawan.');
        return;
      }
      setItems(json.items ?? []);
      setEmployees(json.employees ?? []);
      setAuditLogs(json.auditLogs ?? []);
    } catch {
      toast.error('Gagal terhubung ke server.');
    } finally {
      setLoading(false);
    }
  }, [fromDate, toDate, employeeFilter]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = items.filter((item) => {
      if (!q) return true;
      return (
        item.employee?.name.toLowerCase().includes(q) ||
        item.employee?.position.toLowerCase().includes(q) ||
        item.work_date.includes(q)
      );
    });
    return [...list].sort((a, b) =>
      sortAsc ? a.work_date.localeCompare(b.work_date) : b.work_date.localeCompare(a.work_date)
    );
  }, [items, search, sortAsc]);

  const paginated = useMemo(() => {
    const start = (page - 1) * pageSize;
    return filtered.slice(start, start + pageSize);
  }, [filtered, page, pageSize]);

  useEffect(() => {
    setPage(1);
  }, [search, fromDate, toDate, employeeFilter]);

  const openCorrection = (row: AttendanceRow) => {
    setIsCreating(false);
    setEditing(row);
    setCorrEmployeeId(row.employee_id);
    setCorrWorkDate(row.work_date);
    setCorrMasuk(toWibDatetimeLocal(row.masuk_at));
    setCorrIstirahat(toWibDatetimeLocal(row.istirahat_at));
    setCorrPulang(toWibDatetimeLocal(row.pulang_at));
    setCorrReason('');
  };

  const openNewCorrection = () => {
    const today = getWibDateString();
    setIsCreating(true);
    setEditing(null);
    setCorrEmployeeId(employees[0]?.id ?? '');
    setCorrWorkDate(today);
    setCorrMasuk(`${today}T08:00`);
    setCorrIstirahat('');
    setCorrPulang('');
    setCorrReason('');
  };

  const handleSaveCorrection = async (e: React.FormEvent) => {
    e.preventDefault();
    if (corrReason.trim().length < 5) {
      toast.error('Alasan koreksi wajib diisi minimal 5 karakter.');
      return;
    }
    if (isCreating && !corrEmployeeId) {
      toast.error('Pilih karyawan terlebih dahulu.');
      return;
    }
    if (corrMasuk && corrPulang) {
      const m = fromWibDatetimeLocal(corrMasuk);
      const p = fromWibDatetimeLocal(corrPulang);
      if (m && p && new Date(p) < new Date(m)) {
        toast.error('Jam pulang tidak boleh lebih awal dari jam masuk.');
        return;
      }
    }

    setSaving(true);
    try {
      const res = await fetch('/api/laporan', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          target: 'attendance',
          id: isCreating ? 'NEW' : editing?.id,
          employee_id: corrEmployeeId,
          work_date: corrWorkDate,
          masuk_local: corrMasuk || null,
          istirahat_local: corrIstirahat || null,
          pulang_local: corrPulang || null,
          reason: corrReason.trim(),
        }),
      });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) {
        toast.error(json.error ?? 'Gagal menyimpan koreksi.');
        return;
      }
      toast.success('Koreksi absensi disimpan dan dicatat ke audit log.');
      setEditing(null);
      setIsCreating(false);
      await loadData();
    } catch {
      toast.error('Gagal terhubung ke server.');
    } finally {
      setSaving(false);
    }
  };

  const handleExport = () => {
    const headers = ['MASUK', 'ISTIRAHAT', 'PULANG', 'STAFF', 'DIVISI/JABATAN'];
    const rows = filtered.map((r) => ({
      MASUK: formatWibDateTimeExcel(r.masuk_at),
      ISTIRAHAT: formatWibDateTimeExcel(r.istirahat_at),
      PULANG: formatWibDateTimeExcel(r.pulang_at),
      STAFF: r.employee?.name ?? '-',
      'DIVISI/JABATAN': r.employee?.position ?? '-',
    }));
    exportRowsToExcel('Mutasi_Karyawan.xlsx', 'Mutasi Karyawan', rows, headers);
    toast.success('Export Mutasi Karyawan berhasil.');
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-extrabold text-ink">Laporan Mutasi Karyawan</h1>
          <p className="text-sm text-ink-muted mt-0.5">
            Riwayat absensi masuk, istirahat, dan pulang karyawan (WIB) beserta koreksi beraudit.
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
            onClick={openNewCorrection}
            className="inline-flex items-center gap-2 rounded-xl border border-border-sky bg-white hover:bg-page px-4 py-2.5 text-sm font-semibold text-ink shadow-sm transition"
          >
            <Plus className="w-4 h-4 text-primary-600" />
            <span>Koreksi Susulan</span>
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
              placeholder="Cari nama staff atau jabatan..."
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
          <TableSkeleton rows={6} cols={6} />
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={ClipboardList}
            title="Belum ada data absensi"
            description="Data absensi dari tablet pos security akan tampil di sini."
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
                      <span>Masuk</span>
                      <ArrowUpDown className="w-3.5 h-3.5 opacity-60" />
                    </button>
                  </th>
                  <th className="px-4 py-3">Istirahat</th>
                  <th className="px-4 py-3">Pulang</th>
                  <th className="px-4 py-3">Staff</th>
                  <th className="px-4 py-3">Divisi/Jabatan</th>
                  <th className="px-4 py-3 text-right">Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-sky">
                {paginated.map((row) => (
                  <tr key={row.id} className="hover:bg-page/50">
                    <td className="px-4 py-3 whitespace-nowrap tabular-nums font-medium text-ink">
                      {formatWibDateTime(row.masuk_at)}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap tabular-nums text-ink-muted">
                      {formatWibDateTime(row.istirahat_at)}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap tabular-nums font-medium">
                      {row.pulang_at ? (
                        formatWibDateTime(row.pulang_at)
                      ) : (
                        <span className="inline-flex rounded-full bg-amber-100 text-amber-800 px-2.5 py-0.5 text-xs font-semibold">
                          Belum pulang
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 font-semibold text-ink">{row.employee?.name ?? '-'}</td>
                    <td className="px-4 py-3 text-ink-muted">{row.employee?.position ?? '-'}</td>
                    <td className="px-4 py-3 text-right">
                      <div className="inline-flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => openCorrection(row)}
                          className="inline-flex items-center gap-1 rounded-lg border border-border-sky bg-white hover:bg-primary-50 hover:text-primary-700 px-2.5 py-1.5 text-xs font-semibold transition"
                        >
                          <Edit3 className="w-3.5 h-3.5" />
                          <span>Koreksi</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => setDeleteTarget(row)}
                          className="inline-flex items-center gap-1 rounded-lg border border-border-sky bg-white hover:bg-danger/10 hover:border-danger/30 hover:text-danger px-2.5 py-1.5 text-xs font-semibold transition"
                          title="Hapus data absensi"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                          <span>Hapus</span>
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

      {/* Modal Koreksi */}
      <Modal
        open={Boolean(editing) || isCreating}
        onClose={() => {
          setEditing(null);
          setIsCreating(false);
        }}
        title={isCreating ? 'Tambah Koreksi Absensi Susulan' : `Koreksi Absensi: ${editing?.employee?.name ?? ''}`}
        description="Setiap koreksi wajib disertai alasan dan tersimpan permanen di Audit Log."
      >
        <form onSubmit={handleSaveCorrection} className="space-y-4">
          {isCreating && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-semibold text-ink mb-1">Karyawan *</label>
                <select
                  value={corrEmployeeId}
                  onChange={(e) => setCorrEmployeeId(e.target.value)}
                  className="w-full rounded-xl border border-border-sky px-3 py-2.5 text-sm focus:border-primary-600 focus:outline-none"
                >
                  {employees.map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.name} — {e.position}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-semibold text-ink mb-1">Tanggal Shift *</label>
                <input
                  type="date"
                  value={corrWorkDate}
                  onChange={(e) => setCorrWorkDate(e.target.value)}
                  className="w-full rounded-xl border border-border-sky px-3 py-2.5 text-sm focus:border-primary-600 focus:outline-none"
                />
              </div>
            </div>
          )}

          <div>
            <label className="block text-sm font-semibold text-ink mb-1">Jam Masuk (WIB)</label>
            <input
              type="datetime-local"
              value={corrMasuk}
              onChange={(e) => setCorrMasuk(e.target.value)}
              className="w-full rounded-xl border border-border-sky px-3.5 py-2.5 text-sm focus:border-primary-600 focus:outline-none"
            />
          </div>

          <div>
            <label className="block text-sm font-semibold text-ink mb-1">Jam Istirahat (WIB)</label>
            <input
              type="datetime-local"
              value={corrIstirahat}
              onChange={(e) => setCorrIstirahat(e.target.value)}
              className="w-full rounded-xl border border-border-sky px-3.5 py-2.5 text-sm focus:border-primary-600 focus:outline-none"
            />
          </div>

          <div>
            <label className="block text-sm font-semibold text-ink mb-1">Jam Pulang (WIB)</label>
            <input
              type="datetime-local"
              value={corrPulang}
              onChange={(e) => setCorrPulang(e.target.value)}
              className="w-full rounded-xl border border-border-sky px-3.5 py-2.5 text-sm focus:border-primary-600 focus:outline-none"
            />
          </div>

          <div>
            <label className="block text-sm font-semibold text-ink mb-1">Alasan Koreksi *</label>
            <textarea
              rows={2}
              required
              value={corrReason}
              onChange={(e) => setCorrReason(e.target.value)}
              placeholder="Contoh: Karyawan lupa scan wajah saat pulang shift malam"
              className="w-full rounded-xl border border-border-sky px-3.5 py-2.5 text-sm focus:border-primary-600 focus:outline-none"
            />
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={() => {
                setEditing(null);
                setIsCreating(false);
              }}
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

      <DeleteLaporanModal
        open={Boolean(deleteTarget)}
        title="Hapus Mutasi Karyawan?"
        summary={`Data absensi "${deleteTarget?.employee?.name ?? '-'}" tanggal ${deleteTarget?.work_date ?? '-'} akan dihapus permanen.`}
        loading={deleting}
        onClose={() => setDeleteTarget(null)}
        onConfirm={async (reason) => {
          if (!deleteTarget) return;
          setDeleting(true);
          try {
            const res = await fetch('/api/laporan', {
              method: 'DELETE',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ target: 'attendance', id: deleteTarget.id, reason }),
            });
            const json = (await res.json()) as { error?: string };
            if (!res.ok) {
              toast.error(json.error ?? 'Gagal menghapus data absensi.');
              return;
            }
            toast.success('Data absensi berhasil dihapus dan tercatat di Audit Log.');
            setDeleteTarget(null);
            await loadData();
          } catch {
            toast.error('Gagal terhubung ke server.');
          } finally {
            setDeleting(false);
          }
        }}
      />

      <AuditLogsModal
        open={auditOpen}
        onClose={() => setAuditOpen(false)}
        title="Riwayat Koreksi & Hapus Absensi (Audit Log)"
        auditLogs={auditLogs}
      />
    </div>
  );
}

