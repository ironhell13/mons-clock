'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  ArrowUpDown,
  Download,
  Edit3,
  Loader2,
  Plus,
  Power,
  ScanFace,
  Search,
  Trash2,
  Upload,
} from 'lucide-react';
import { toast } from 'sonner';
import { MASTER_CONFIG } from '@/lib/master-config';
import { exportRowsToExcel, type MasterEntityKey } from '@/lib/excel';
import {
  areaSchema,
  cleanText,
  employeeSchema,
  escortSchema,
  normalizePlate,
  vehicleSchema,
  workshopSchema,
} from '@/lib/validators';
import { Modal } from '@/components/ui/Modal';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { EmptyState } from '@/components/ui/EmptyState';
import { TableSkeleton } from '@/components/ui/Skeleton';
import { DataTablePagination } from '@/components/ui/DataTablePagination';
import { AutocompleteInput } from '@/components/ui/AutocompleteInput';
import { ExcelImportModal } from '@/components/admin/ExcelImportModal';

interface MasterRecord {
  id: string;
  is_active: boolean;
  created_at: string;
  rfid_no?: string | null;
  name?: string;
  position?: string;
  employee_no?: string;
  vendor?: string;
  plate?: string;
  face_count?: number;
}

export function MasterPageClient({ entity }: { entity: MasterEntityKey }) {
  const meta = MASTER_CONFIG[entity];
  const [items, setItems] = useState<MasterRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive'>('all');
  const [sortKey, setSortKey] = useState<string>(meta.defaultSortKey);
  const [sortAsc, setSortAsc] = useState(true);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  // Modals
  const [formOpen, setFormOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<MasterRecord | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<MasterRecord | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Form state
  const [rfidNo, setRfidNo] = useState('');
  const [nameVal, setNameVal] = useState('');
  const [positionVal, setPositionVal] = useState('');
  const [employeeNo, setEmployeeNo] = useState('');
  const [vendorVal, setVendorVal] = useState('');
  const [plateVal, setPlateVal] = useState('');
  const [formError, setFormError] = useState<string | null>(null);

  const loadItems = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/master/${entity}`, { cache: 'no-store' });
      const json = (await res.json()) as { items?: MasterRecord[]; error?: string };
      if (!res.ok) {
        toast.error(json.error ?? 'Gagal memuat data master.');
        return;
      }
      setItems(json.items ?? []);
    } catch {
      toast.error('Gagal terhubung ke server.');
    } finally {
      setLoading(false);
    }
  }, [entity]);

  useEffect(() => {
    loadItems();
  }, [loadItems]);

  const existingVendors = useMemo(() => {
    if (entity !== 'pengawal') return [];
    const unique = Array.from(
      new Set(items.map((i) => i.vendor).filter((v): v is string => Boolean(v)))
    ).sort((a, b) => a.localeCompare(b));
    return unique.map((v) => ({ value: v, label: v }));
  }, [entity, items]);

  const filteredAndSorted = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filtered = items.filter((item) => {
      if (statusFilter === 'active' && !item.is_active) return false;
      if (statusFilter === 'inactive' && item.is_active) return false;
      if (!q) return true;
      return [item.name, item.position, item.employee_no, item.rfid_no, item.vendor, item.plate]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q));
    });

    return [...filtered].sort((a, b) => {
      const av = String((a as unknown as Record<string, unknown>)[sortKey] ?? '').toLowerCase();
      const bv = String((b as unknown as Record<string, unknown>)[sortKey] ?? '').toLowerCase();
      return sortAsc ? av.localeCompare(bv) : bv.localeCompare(av);
    });
  }, [items, search, statusFilter, sortKey, sortAsc]);

  const paginated = useMemo(() => {
    const start = (page - 1) * pageSize;
    return filteredAndSorted.slice(start, start + pageSize);
  }, [filteredAndSorted, page, pageSize]);

  useEffect(() => {
    setPage(1);
  }, [search, statusFilter]);

  const toggleSort = (key: string) => {
    if (sortKey === key) {
      setSortAsc((prev) => !prev);
    } else {
      setSortKey(key);
      setSortAsc(true);
    }
  };

  const openCreateModal = () => {
    setEditingItem(null);
    setRfidNo('');
    setNameVal('');
    setPositionVal('');
    setEmployeeNo('');
    setVendorVal('');
    setPlateVal('');
    setFormError(null);
    setFormOpen(true);
  };

  const openEditModal = (item: MasterRecord) => {
    setEditingItem(item);
    setRfidNo(item.rfid_no ?? '');
    setNameVal(item.name ?? '');
    setPositionVal(item.position ?? '');
    setEmployeeNo(item.employee_no ?? '');
    setVendorVal(item.vendor ?? '');
    setPlateVal(item.plate ?? '');
    setFormError(null);
    setFormOpen(true);
  };

  const handleSubmitForm = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    let payload: Record<string, unknown> = {};
    if (entity === 'karyawan') {
      const parsed = employeeSchema.safeParse({
        rfid_no: rfidNo ? cleanText(rfidNo) : null,
        name: cleanText(nameVal),
        position: cleanText(positionVal),
        employee_no: cleanText(employeeNo),
        is_active: editingItem?.is_active ?? true,
      });
      if (!parsed.success) {
        setFormError(parsed.error.errors[0]?.message ?? 'Input tidak valid.');
        return;
      }
      payload = parsed.data;
    } else if (entity === 'pengawal') {
      const parsed = escortSchema.safeParse({
        name: cleanText(nameVal),
        vendor: cleanText(vendorVal),
        is_active: editingItem?.is_active ?? true,
      });
      if (!parsed.success) {
        setFormError(parsed.error.errors[0]?.message ?? 'Input tidak valid.');
        return;
      }
      payload = parsed.data;
    } else if (entity === 'area') {
      const parsed = areaSchema.safeParse({
        name: cleanText(nameVal),
        is_active: editingItem?.is_active ?? true,
      });
      if (!parsed.success) {
        setFormError(parsed.error.errors[0]?.message ?? 'Input tidak valid.');
        return;
      }
      payload = parsed.data;
    } else if (entity === 'nopol') {
      const parsed = vehicleSchema.safeParse({
        plate: normalizePlate(plateVal),
        is_active: editingItem?.is_active ?? true,
      });
      if (!parsed.success) {
        setFormError(parsed.error.errors[0]?.message ?? 'Input tidak valid.');
        return;
      }
      payload = parsed.data;
    } else if (entity === 'bengkel') {
      const parsed = workshopSchema.safeParse({
        name: cleanText(nameVal),
        is_active: editingItem?.is_active ?? true,
      });
      if (!parsed.success) {
        setFormError(parsed.error.errors[0]?.message ?? 'Input tidak valid.');
        return;
      }
      payload = parsed.data;
    }

    setSaving(true);
    try {
      const res = await fetch(`/api/master/${entity}`, {
        method: editingItem ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editingItem ? { id: editingItem.id, ...payload } : payload),
      });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) {
        setFormError(json.error ?? 'Gagal menyimpan data.');
        return;
      }
      toast.success(
        editingItem
          ? `${meta.singular} berhasil diperbarui.`
          : `${meta.singular} baru berhasil ditambahkan.`
      );
      setFormOpen(false);
      await loadItems();
    } catch {
      toast.error('Terjadi kesalahan saat menyimpan.');
    } finally {
      setSaving(false);
    }
  };

  const handleToggleActive = async (item: MasterRecord) => {
    try {
      const res = await fetch(`/api/master/${entity}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: item.id, is_active: !item.is_active }),
      });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) {
        toast.error(json.error ?? 'Gagal mengubah status.');
        return;
      }
      toast.success(item.is_active ? 'Data dinonaktifkan.' : 'Data diaktifkan kembali.');
      await loadItems();
    } catch {
      toast.error('Gagal terhubung ke server.');
    }
  };

  const handleConfirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/master/${entity}?id=${deleteTarget.id}`, {
        method: 'DELETE',
      });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) {
        toast.error(json.error ?? 'Gagal menghapus data.');
        return;
      }
      toast.success(`${meta.singular} berhasil dihapus.`);
      setDeleteTarget(null);
      await loadItems();
    } catch {
      toast.error('Gagal terhubung ke server.');
    } finally {
      setDeleting(false);
    }
  };

  const handleExport = () => {
    const rows = filteredAndSorted.map((item) => {
      if (entity === 'karyawan') {
        return {
          'NO RFID': item.rfid_no ?? '',
          NAMA: item.name ?? '',
          JABATAN: item.position ?? '',
          'NO ID': item.employee_no ?? '',
        };
      }
      if (entity === 'pengawal') {
        return {
          NAMA: item.name ?? '',
          VENDOR: item.vendor ?? '',
        };
      }
      if (entity === 'area') {
        return { AREA: item.name ?? '' };
      }
      if (entity === 'nopol') {
        return { NOPOL: item.plate ?? '' };
      }
      return { 'NAMA BENGKEL': item.name ?? '' };
    });

    exportRowsToExcel(meta.exportFilename, meta.sheetName, rows, meta.exportHeaders);
    toast.success(`Export ${meta.exportFilename} berhasil.`);
  };

  const renderSortButton = (key: string, label: string) => (
    <button
      type="button"
      onClick={() => toggleSort(key)}
      className="inline-flex items-center gap-1 hover:text-primary-700 transition"
    >
      <span>{label}</span>
      <ArrowUpDown className="w-3.5 h-3.5 opacity-60" />
    </button>
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-extrabold text-ink">{meta.title}</h1>
          <p className="text-sm text-ink-muted mt-0.5">{meta.description}</p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            onClick={() => setImportOpen(true)}
            className="inline-flex items-center gap-2 rounded-xl border border-border-sky bg-white hover:bg-page px-4 py-2.5 text-sm font-semibold text-ink shadow-sm transition"
          >
            <Upload className="w-4 h-4 text-primary-600" />
            <span>Import Excel</span>
          </button>
          <button
            type="button"
            onClick={handleExport}
            disabled={filteredAndSorted.length === 0}
            className="inline-flex items-center gap-2 rounded-xl border border-border-sky bg-white hover:bg-page disabled:opacity-50 px-4 py-2.5 text-sm font-semibold text-ink shadow-sm transition"
          >
            <Download className="w-4 h-4 text-primary-600" />
            <span>Export Excel</span>
          </button>
          <button
            type="button"
            onClick={openCreateModal}
            className="inline-flex items-center gap-2 rounded-xl bg-primary-600 hover:bg-primary-700 text-white px-4 py-2.5 text-sm font-semibold shadow-soft transition"
          >
            <Plus className="w-4 h-4" />
            <span>Tambah {meta.singular}</span>
          </button>
        </div>
      </div>

      <div className="rounded-2xl bg-surface border border-border-sky shadow-soft overflow-hidden">
        <div className="p-4 border-b border-border-sky flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="relative flex-1 max-w-md">
            <Search className="w-4 h-4 text-ink-muted absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={`Cari ${meta.singular.toLowerCase()}...`}
              className="w-full rounded-xl border border-border-sky bg-page/50 pl-10 pr-4 py-2.5 text-sm text-ink focus:border-primary-600 focus:bg-white focus:outline-none"
            />
          </div>

          <div className="flex items-center gap-2">
            {(['all', 'active', 'inactive'] as const).map((status) => (
              <button
                key={status}
                type="button"
                onClick={() => setStatusFilter(status)}
                className={`rounded-xl px-3.5 py-2 text-xs font-semibold transition ${
                  statusFilter === status
                    ? 'bg-primary-100 text-primary-700'
                    : 'bg-page text-ink-muted hover:text-ink'
                }`}
              >
                {status === 'all' ? 'Semua' : status === 'active' ? 'Aktif' : 'Nonaktif'}
              </button>
            ))}
          </div>
        </div>

        {loading ? (
          <TableSkeleton rows={6} cols={5} />
        ) : filteredAndSorted.length === 0 ? (
          <EmptyState
            title={`Belum ada data ${meta.singular.toLowerCase()}`}
            description="Tambahkan data baru secara manual atau import langsung dari file Excel."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead className="bg-primary-50 text-ink font-bold text-xs uppercase tracking-wider">
                <tr>
                  {entity === 'karyawan' && (
                    <>
                      <th className="px-4 py-3">{renderSortButton('employee_no', 'No ID')}</th>
                      <th className="px-4 py-3">{renderSortButton('rfid_no', 'No RFID')}</th>
                      <th className="px-4 py-3">{renderSortButton('name', 'Nama')}</th>
                      <th className="px-4 py-3">{renderSortButton('position', 'Jabatan')}</th>
                      <th className="px-4 py-3">Status Wajah</th>
                    </>
                  )}
                  {entity === 'pengawal' && (
                    <>
                      <th className="px-4 py-3">{renderSortButton('name', 'Nama Pengawal')}</th>
                      <th className="px-4 py-3">{renderSortButton('vendor', 'Vendor')}</th>
                      <th className="px-4 py-3">Status Wajah</th>
                    </>
                  )}
                  {entity === 'area' && (
                    <th className="px-4 py-3">{renderSortButton('name', 'Nama Area')}</th>
                  )}
                  {entity === 'nopol' && (
                    <th className="px-4 py-3">{renderSortButton('plate', 'Nomor Polisi')}</th>
                  )}
                  {entity === 'bengkel' && (
                    <th className="px-4 py-3">{renderSortButton('name', 'Nama Bengkel')}</th>
                  )}
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3 text-right">Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-sky">
                {paginated.map((item) => (
                  <tr key={item.id} className="hover:bg-page/50 transition">
                    {entity === 'karyawan' && (
                      <>
                        <td className="px-4 py-3 font-mono text-xs font-semibold text-ink">
                          {item.employee_no}
                        </td>
                        <td className="px-4 py-3 font-mono text-xs text-ink-muted">
                          {item.rfid_no || '-'}
                        </td>
                        <td className="px-4 py-3 font-semibold text-ink">{item.name}</td>
                        <td className="px-4 py-3 text-ink-muted">{item.position}</td>
                        <td className="px-4 py-3">
                          {(item.face_count ?? 0) > 0 ? (
                            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 text-emerald-800 px-2.5 py-0.5 text-xs font-semibold">
                              <ScanFace className="w-3.5 h-3.5" />
                              Terdaftar ({item.face_count} sampel)
                            </span>
                          ) : (
                            <Link
                              href="/admin/wajah"
                              className="inline-flex items-center gap-1 rounded-full bg-amber-100 text-amber-800 hover:bg-amber-200 px-2.5 py-0.5 text-xs font-semibold transition"
                            >
                              Belum
                            </Link>
                          )}
                        </td>
                      </>
                    )}
                    {entity === 'pengawal' && (
                      <>
                        <td className="px-4 py-3 font-semibold text-ink">{item.name}</td>
                        <td className="px-4 py-3">
                          <span className="inline-flex rounded-lg bg-primary-100 text-primary-700 px-2.5 py-0.5 text-xs font-bold">
                            {item.vendor}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          {(item.face_count ?? 0) > 0 ? (
                            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 text-emerald-800 px-2.5 py-0.5 text-xs font-semibold">
                              <ScanFace className="w-3.5 h-3.5" />
                              Terdaftar ({item.face_count} sampel)
                            </span>
                          ) : (
                            <Link
                              href="/admin/wajah"
                              className="inline-flex items-center gap-1 rounded-full bg-amber-100 text-amber-800 hover:bg-amber-200 px-2.5 py-0.5 text-xs font-semibold transition"
                            >
                              Belum
                            </Link>
                          )}
                        </td>
                      </>
                    )}
                    {entity === 'area' && (
                      <td className="px-4 py-3 font-semibold text-ink">{item.name}</td>
                    )}
                    {entity === 'nopol' && (
                      <td className="px-4 py-3 font-bold text-ink tracking-wide">{item.plate}</td>
                    )}
                    {entity === 'bengkel' && (
                      <td className="px-4 py-3 font-semibold text-ink">{item.name}</td>
                    )}

                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                          item.is_active
                            ? 'bg-emerald-100 text-emerald-800'
                            : 'bg-slate-200 text-slate-600'
                        }`}
                      >
                        {item.is_active ? 'Aktif' : 'Nonaktif'}
                      </span>
                    </td>

                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1.5">
                        <button
                          type="button"
                          onClick={() => openEditModal(item)}
                          className="p-2 rounded-lg text-ink-muted hover:bg-primary-50 hover:text-primary-700 transition"
                          title="Edit"
                        >
                          <Edit3 className="w-4 h-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleToggleActive(item)}
                          className={`p-2 rounded-lg transition ${
                            item.is_active
                              ? 'text-ink-muted hover:bg-amber-50 hover:text-amber-700'
                              : 'text-emerald-600 hover:bg-emerald-50'
                          }`}
                          title={item.is_active ? 'Nonaktifkan' : 'Aktifkan'}
                        >
                          <Power className="w-4 h-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => setDeleteTarget(item)}
                          className="p-2 rounded-lg text-ink-muted hover:bg-danger/10 hover:text-danger transition"
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
          totalItems={filteredAndSorted.length}
          page={page}
          pageSize={pageSize}
          onPageChange={setPage}
          onPageSizeChange={setPageSize}
        />
      </div>

      {/* Add / Edit Modal */}
      <Modal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        title={editingItem ? `Edit ${meta.singular}` : `Tambah ${meta.singular}`}
      >
        <form onSubmit={handleSubmitForm} className="space-y-4">
          {formError && (
            <div className="rounded-xl bg-danger/10 border border-danger/30 px-4 py-2.5 text-xs font-semibold text-danger">
              {formError}
            </div>
          )}

          {entity === 'karyawan' && (
            <>
              <div>
                <label className="block text-sm font-semibold text-ink mb-1">No ID *</label>
                <input
                  type="text"
                  value={employeeNo}
                  onChange={(e) => setEmployeeNo(e.target.value)}
                  placeholder="Contoh: 2010571"
                  className="w-full rounded-xl border border-border-sky px-3.5 py-2.5 text-sm focus:border-primary-600 focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-ink mb-1">No RFID</label>
                <input
                  type="text"
                  value={rfidNo}
                  onChange={(e) => setRfidNo(e.target.value)}
                  placeholder="Contoh: 11715290"
                  className="w-full rounded-xl border border-border-sky px-3.5 py-2.5 text-sm focus:border-primary-600 focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-ink mb-1">Nama Lengkap *</label>
                <input
                  type="text"
                  value={nameVal}
                  onChange={(e) => setNameVal(e.target.value)}
                  placeholder="Nama karyawan"
                  className="w-full rounded-xl border border-border-sky px-3.5 py-2.5 text-sm focus:border-primary-600 focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-ink mb-1">Jabatan *</label>
                <input
                  type="text"
                  value={positionVal}
                  onChange={(e) => setPositionVal(e.target.value)}
                  placeholder="Contoh: Kepala Team ATM"
                  className="w-full rounded-xl border border-border-sky px-3.5 py-2.5 text-sm focus:border-primary-600 focus:outline-none"
                />
              </div>
            </>
          )}

          {entity === 'pengawal' && (
            <>
              <div>
                <label className="block text-sm font-semibold text-ink mb-1">Nama Pengawal *</label>
                <input
                  type="text"
                  value={nameVal}
                  onChange={(e) => setNameVal(e.target.value)}
                  placeholder="Nama lengkap pengawal"
                  className="w-full rounded-xl border border-border-sky px-3.5 py-2.5 text-sm focus:border-primary-600 focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-ink mb-1">Vendor *</label>
                <AutocompleteInput
                  options={existingVendors}
                  value={vendorVal}
                  onChange={(val) => setVendorVal(val)}
                  placeholder="Pilih vendor atau ketik vendor baru"
                  allowFreeText
                />
              </div>
            </>
          )}

          {entity === 'area' && (
            <div>
              <label className="block text-sm font-semibold text-ink mb-1">Nama Area *</label>
              <input
                type="text"
                value={nameVal}
                onChange={(e) => setNameVal(e.target.value)}
                placeholder="Contoh: BINTARO"
                className="w-full rounded-xl border border-border-sky px-3.5 py-2.5 text-sm focus:border-primary-600 focus:outline-none"
              />
            </div>
          )}

          {entity === 'nopol' && (
            <div>
              <label className="block text-sm font-semibold text-ink mb-1">Nomor Polisi *</label>
              <input
                type="text"
                value={plateVal}
                onChange={(e) => setPlateVal(e.target.value.toUpperCase())}
                placeholder="Contoh: B 1549 SZV"
                className="w-full rounded-xl border border-border-sky px-3.5 py-2.5 text-sm uppercase font-bold tracking-wide focus:border-primary-600 focus:outline-none"
              />
            </div>
          )}

          {entity === 'bengkel' && (
            <div>
              <label className="block text-sm font-semibold text-ink mb-1">Nama Bengkel *</label>
              <input
                type="text"
                value={nameVal}
                onChange={(e) => setNameVal(e.target.value)}
                placeholder="Contoh: Tata Jaya Motor"
                className="w-full rounded-xl border border-border-sky px-3.5 py-2.5 text-sm focus:border-primary-600 focus:outline-none"
              />
            </div>
          )}

          <div className="flex items-center justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={() => setFormOpen(false)}
              className="rounded-xl border border-border-sky bg-white px-4 py-2.5 text-sm font-semibold text-ink hover:bg-page"
            >
              Batal
            </button>
            <button
              type="submit"
              disabled={saving}
              className="rounded-xl bg-primary-600 hover:bg-primary-700 disabled:opacity-60 text-white px-5 py-2.5 text-sm font-semibold flex items-center gap-2 transition"
            >
              {saving && <Loader2 className="w-4 h-4 animate-spin" />}
              <span>{editingItem ? 'Simpan Perubahan' : 'Simpan'}</span>
            </button>
          </div>
        </form>
      </Modal>

      <ExcelImportModal
        open={importOpen}
        onClose={() => setImportOpen(false)}
        entity={entity}
        onImported={loadItems}
      />

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleConfirmDelete}
        loading={deleting}
        title={`Hapus ${meta.singular}?`}
        message={`Data "${
          deleteTarget?.name ?? deleteTarget?.plate ?? ''
        }" akan dihapus permanen. Jika sudah pernah dipakai pada transaksi, gunakan fitur Nonaktifkan.`}
        confirmLabel="Hapus Permanen"
      />
    </div>
  );
}

