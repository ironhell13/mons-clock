'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Plus, ScanFace, Search, Shield, Trash2, Users } from 'lucide-react';
import { toast } from 'sonner';
import type { SubjectType } from '@/types/database';
import { invalidateFaceTemplatesCache } from '@/lib/face-cache';
import { DynamicFaceEnrollView } from '@/components/face/DynamicFaceWidgets';
import { Modal } from '@/components/ui/Modal';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { EmptyState } from '@/components/ui/EmptyState';
import { TableSkeleton } from '@/components/ui/Skeleton';

interface SubjectRow {
  id: string;
  subject_type: SubjectType;
  name: string;
  subtitle: string;
  code: string;
  is_active: boolean;
  sample_count: number;
}

export function AdminFaceManagerClient() {
  const [tab, setTab] = useState<SubjectType>('employee');
  const [subjects, setSubjects] = useState<SubjectRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterReg, setFilterReg] = useState<'all' | 'enrolled' | 'unenrolled'>('all');

  const [enrollTarget, setEnrollTarget] = useState<SubjectRow | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<SubjectRow | null>(null);
  const [deleting, setDeleting] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/face/templates?subject_type=all', { cache: 'no-store' });
      const json = (await res.json()) as { subjects?: SubjectRow[]; error?: string };
      if (!res.ok) {
        toast.error(json.error ?? 'Gagal memuat data wajah.');
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
    loadData();
  }, [loadData]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return subjects.filter((s) => {
      if (s.subject_type !== tab) return false;
      if (filterReg === 'enrolled' && s.sample_count === 0) return false;
      if (filterReg === 'unenrolled' && s.sample_count > 0) return false;
      if (!q) return true;
      return (
        s.name.toLowerCase().includes(q) ||
        s.subtitle.toLowerCase().includes(q) ||
        s.code.toLowerCase().includes(q)
      );
    });
  }, [subjects, tab, filterReg, search]);

  const handleDeleteTemplates = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const res = await fetch(
        `/api/face/templates?subject_type=${deleteTarget.subject_type}&subject_id=${deleteTarget.id}`,
        { method: 'DELETE' }
      );
      const json = (await res.json()) as { error?: string };
      if (!res.ok) {
        toast.error(json.error ?? 'Gagal menghapus template wajah.');
        return;
      }
      invalidateFaceTemplatesCache(deleteTarget.subject_type);
      toast.success(`Template wajah ${deleteTarget.name} dihapus.`);
      setDeleteTarget(null);
      await loadData();
    } catch {
      toast.error('Gagal terhubung ke server.');
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-extrabold text-ink">Kelola Pendaftaran Wajah</h1>
        <p className="text-sm text-ink-muted mt-0.5">
          Daftarkan wajah karyawan dan pengawal lewat webcam PC, tambah sampel, atau reset template.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => setTab('employee')}
          className={`inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-bold border transition ${
            tab === 'employee'
              ? 'bg-primary-600 text-white border-primary-600 shadow-soft'
              : 'bg-white text-ink-muted border-border-sky hover:text-ink'
          }`}
        >
          <Users className="w-4 h-4" />
          <span>Karyawan ({subjects.filter((s) => s.subject_type === 'employee').length})</span>
        </button>
        <button
          type="button"
          onClick={() => setTab('escort')}
          className={`inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-bold border transition ${
            tab === 'escort'
              ? 'bg-primary-600 text-white border-primary-600 shadow-soft'
              : 'bg-white text-ink-muted border-border-sky hover:text-ink'
          }`}
        >
          <Shield className="w-4 h-4" />
          <span>Pengawal ({subjects.filter((s) => s.subject_type === 'escort').length})</span>
        </button>
      </div>

      <div className="rounded-2xl bg-surface border border-border-sky shadow-soft overflow-hidden">
        <div className="p-4 border-b border-border-sky flex flex-wrap items-center justify-between gap-3">
          <div className="relative flex-1 min-w-[220px] max-w-md">
            <Search className="w-4 h-4 text-ink-muted absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={`Cari ${tab === 'employee' ? 'nama, jabatan, no ID' : 'nama, vendor'}...`}
              className="w-full rounded-xl border border-border-sky bg-page/50 pl-10 pr-4 py-2.5 text-sm focus:border-primary-600 focus:bg-white focus:outline-none"
            />
          </div>

          <div className="flex items-center gap-2">
            {(
              [
                { k: 'all', l: 'Semua' },
                { k: 'enrolled', l: 'Sudah Terdaftar' },
                { k: 'unenrolled', l: 'Belum Terdaftar' },
              ] as const
            ).map((opt) => (
              <button
                key={opt.k}
                type="button"
                onClick={() => setFilterReg(opt.k)}
                className={`rounded-xl px-3.5 py-2 text-xs font-semibold transition ${
                  filterReg === opt.k
                    ? 'bg-primary-100 text-primary-700'
                    : 'bg-page text-ink-muted hover:text-ink'
                }`}
              >
                {opt.l}
              </button>
            ))}
          </div>
        </div>

        {loading ? (
          <TableSkeleton rows={6} cols={5} />
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={ScanFace}
            title="Tidak ada data yang cocok"
            description="Ubah filter pencarian atau tambahkan data master terlebih dahulu."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead className="bg-primary-50 text-ink font-bold text-xs uppercase tracking-wider">
                <tr>
                  <th className="px-4 py-3">Nama</th>
                  <th className="px-4 py-3">{tab === 'employee' ? 'Jabatan' : 'Vendor'}</th>
                  {tab === 'employee' && <th className="px-4 py-3">No ID</th>}
                  <th className="px-4 py-3">Status Wajah</th>
                  <th className="px-4 py-3 text-right">Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-sky">
                {filtered.map((item) => (
                  <tr key={item.id} className="hover:bg-page/50">
                    <td className="px-4 py-3 font-semibold text-ink">{item.name}</td>
                    <td className="px-4 py-3 text-ink-muted">{item.subtitle}</td>
                    {tab === 'employee' && (
                      <td className="px-4 py-3 font-mono text-xs">{item.code}</td>
                    )}
                    <td className="px-4 py-3">
                      {item.sample_count > 0 ? (
                        <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-100 text-emerald-800 px-3 py-0.5 text-xs font-bold">
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          Terdaftar ({item.sample_count} sampel)
                        </span>
                      ) : (
                        <span className="inline-flex rounded-full bg-amber-100 text-amber-800 px-3 py-0.5 text-xs font-semibold">
                          Belum terdaftar
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => setEnrollTarget(item)}
                          className="inline-flex items-center gap-1.5 rounded-xl bg-primary-600 hover:bg-primary-700 text-white px-3 py-1.5 text-xs font-bold transition"
                        >
                          {item.sample_count > 0 ? (
                            <Plus className="w-3.5 h-3.5" />
                          ) : (
                            <ScanFace className="w-3.5 h-3.5" />
                          )}
                          <span>
                            {item.sample_count > 0 ? 'Tambah Sampel' : 'Daftarkan Wajah'}
                          </span>
                        </button>
                        {item.sample_count > 0 && (
                          <button
                            type="button"
                            onClick={() => setDeleteTarget(item)}
                            className="p-2 rounded-lg text-ink-muted hover:bg-danger/10 hover:text-danger transition"
                            title="Hapus semua template wajah"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <Modal
        open={Boolean(enrollTarget)}
        onClose={() => setEnrollTarget(null)}
        title={`Pendaftaran Wajah: ${enrollTarget?.name ?? ''}`}
        maxWidthClass="max-w-2xl"
      >
        {enrollTarget && (
          <DynamicFaceEnrollView
            subjectType={enrollTarget.subject_type}
            subjectId={enrollTarget.id}
            subjectName={enrollTarget.name}
            onCancel={() => setEnrollTarget(null)}
            onSuccess={(count) => {
              toast.success(`${count} sampel wajah ${enrollTarget.name} berhasil disimpan.`);
              setEnrollTarget(null);
              loadData();
            }}
          />
        )}
      </Modal>

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleDeleteTemplates}
        loading={deleting}
        title="Hapus Template Wajah?"
        message={`Seluruh sampel wajah milik "${deleteTarget?.name ?? ''}" akan dihapus. Orang ini harus mendaftarkan wajah ulang sebelum bisa absen.`}
        confirmLabel="Hapus Semua Template"
      />
    </div>
  );
}
