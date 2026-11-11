'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  KeyRound,
  Loader2,
  Plus,
  Power,
  ShieldCheck,
  UserCog,
} from 'lucide-react';
import { toast } from 'sonner';
import type { Profile, UserRole } from '@/types/database';
import { formatWibDateTime } from '@/lib/time';
import { Modal } from '@/components/ui/Modal';
import { EmptyState } from '@/components/ui/EmptyState';
import { TableSkeleton } from '@/components/ui/Skeleton';

export function UsersManagerClient() {
  const [items, setItems] = useState<Profile[]>([]);
  const [currentUserId, setCurrentUserId] = useState<string>('');
  const [loading, setLoading] = useState(true);

  // Create modal
  const [createOpen, setCreateOpen] = useState(false);
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<'admin' | 'absen'>('admin');
  const [saving, setSaving] = useState(false);

  // Reset password modal
  const [resetTarget, setResetTarget] = useState<Profile | null>(null);
  const [newPassword, setNewPassword] = useState('');
  const [resetting, setResetting] = useState(false);

  const loadUsers = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/users', { cache: 'no-store' });
      const json = (await res.json()) as {
        items?: Profile[];
        currentUserId?: string;
        error?: string;
      };
      if (!res.ok) {
        toast.error(json.error ?? 'Gagal memuat daftar user.');
        return;
      }
      setItems(json.items ?? []);
      setCurrentUserId(json.currentUserId ?? '');
    } catch {
      toast.error('Gagal terhubung ke server.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadUsers();
  }, [loadUsers]);

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await fetch('/api/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ full_name: fullName, email, password, role }),
      });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) {
        toast.error(json.error ?? 'Gagal menambah user.');
        return;
      }
      toast.success('Akun user baru berhasil dibuat.');
      setCreateOpen(false);
      setFullName('');
      setEmail('');
      setPassword('');
      setRole('admin');
      await loadUsers();
    } catch {
      toast.error('Gagal terhubung ke server.');
    } finally {
      setSaving(false);
    }
  };

  const handleChangeRole = async (user: Profile, nextRole: UserRole) => {
    if (user.id === currentUserId) return;
    try {
      const res = await fetch('/api/users', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: user.id, role: nextRole }),
      });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) {
        toast.error(json.error ?? 'Gagal mengubah role.');
        return;
      }
      toast.success(`Role ${user.full_name} diubah menjadi ${nextRole}.`);
      await loadUsers();
    } catch {
      toast.error('Gagal terhubung ke server.');
    }
  };

  const handleToggleActive = async (user: Profile) => {
    if (user.id === currentUserId) {
      toast.error('Anda tidak dapat menonaktifkan akun sendiri.');
      return;
    }
    try {
      const res = await fetch('/api/users', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: user.id, is_active: !user.is_active }),
      });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) {
        toast.error(json.error ?? 'Gagal mengubah status user.');
        return;
      }
      toast.success(user.is_active ? 'User dinonaktifkan.' : 'User diaktifkan.');
      await loadUsers();
    } catch {
      toast.error('Gagal terhubung ke server.');
    }
  };

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!resetTarget) return;
    if (newPassword.length < 6) {
      toast.error('Password baru minimal 6 karakter.');
      return;
    }
    setResetting(true);
    try {
      const res = await fetch('/api/users', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: resetTarget.id, new_password: newPassword }),
      });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) {
        toast.error(json.error ?? 'Gagal mereset password.');
        return;
      }
      toast.success(`Password untuk ${resetTarget.full_name} berhasil direset.`);
      setResetTarget(null);
      setNewPassword('');
    } catch {
      toast.error('Gagal terhubung ke server.');
    } finally {
      setResetting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-extrabold text-ink">Manajemen User (Superadmin)</h1>
          <p className="text-sm text-ink-muted mt-0.5">
            Kelola akun admin dashboard dan akun perangkat tablet pos security (role absen).
          </p>
        </div>

        <button
          type="button"
          onClick={() => setCreateOpen(true)}
          className="inline-flex items-center gap-2 rounded-xl bg-primary-600 hover:bg-primary-700 text-white px-4 py-2.5 text-sm font-semibold shadow-soft transition"
        >
          <Plus className="w-4 h-4" />
          <span>Tambah User Baru</span>
        </button>
      </div>

      <div className="rounded-2xl bg-surface border border-border-sky shadow-soft overflow-hidden">
        {loading ? (
          <TableSkeleton rows={4} cols={6} />
        ) : items.length === 0 ? (
          <EmptyState icon={UserCog} title="Belum ada akun terdaftar" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead className="bg-primary-50 text-ink font-bold text-xs uppercase tracking-wider">
                <tr>
                  <th className="px-4 py-3">Nama Lengkap</th>
                  <th className="px-4 py-3">Email</th>
                  <th className="px-4 py-3">Role</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Dibuat</th>
                  <th className="px-4 py-3 text-right">Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-sky">
                {items.map((u) => {
                  const isSelf = u.id === currentUserId;
                  return (
                    <tr key={u.id} className="hover:bg-page/50">
                      <td className="px-4 py-3 font-semibold text-ink">
                        {u.full_name}
                        {isSelf && (
                          <span className="ml-2 rounded-md bg-primary-100 text-primary-700 px-2 py-0.5 text-[11px] font-bold">
                            Anda
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-ink-muted">{u.email ?? '-'}</td>
                      <td className="px-4 py-3">
                        {u.role === 'superadmin' ? (
                          <span className="inline-flex items-center gap-1 rounded-lg bg-indigo-100 text-indigo-800 px-2.5 py-1 text-xs font-bold">
                            <ShieldCheck className="w-3.5 h-3.5" />
                            superadmin
                          </span>
                        ) : (
                          <select
                            value={u.role}
                            disabled={isSelf}
                            onChange={(e) => handleChangeRole(u, e.target.value as UserRole)}
                            className="rounded-lg border border-border-sky bg-white px-2.5 py-1 text-xs font-bold text-ink focus:border-primary-600 focus:outline-none"
                          >
                            <option value="admin">admin</option>
                            <option value="absen">absen (tablet)</option>
                          </select>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                            u.is_active
                              ? 'bg-emerald-100 text-emerald-800'
                              : 'bg-slate-200 text-slate-600'
                          }`}
                        >
                          {u.is_active ? 'Aktif' : 'Nonaktif'}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-xs text-ink-muted whitespace-nowrap">
                        {formatWibDateTime(u.created_at)} WIB
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            type="button"
                            onClick={() => {
                              setResetTarget(u);
                              setNewPassword('');
                            }}
                            className="inline-flex items-center gap-1 rounded-lg border border-border-sky bg-white hover:bg-primary-50 px-2.5 py-1.5 text-xs font-semibold text-ink transition"
                            title="Reset Password"
                          >
                            <KeyRound className="w-3.5 h-3.5 text-primary-600" />
                            <span>Reset Password</span>
                          </button>
                          <button
                            type="button"
                            disabled={isSelf}
                            onClick={() => handleToggleActive(u)}
                            className={`p-2 rounded-lg transition disabled:opacity-30 ${
                              u.is_active
                                ? 'text-ink-muted hover:bg-amber-50 hover:text-amber-700'
                                : 'text-emerald-600 hover:bg-emerald-50'
                            }`}
                            title={isSelf ? 'Tidak dapat menonaktifkan diri sendiri' : u.is_active ? 'Nonaktifkan' : 'Aktifkan'}
                          >
                            <Power className="w-4 h-4" />
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

      <Modal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="Tambah User Baru"
        description="Buat akun Admin (untuk PC) atau akun Absen (untuk tablet pos security)."
      >
        <form onSubmit={handleCreateUser} className="space-y-4">
          <div>
            <label className="block text-sm font-semibold text-ink mb-1">Nama Lengkap *</label>
            <input
              type="text"
              required
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="Contoh: Admin Pos Security / Tablet Pos 1"
              className="w-full rounded-xl border border-border-sky px-3.5 py-2.5 text-sm focus:border-primary-600 focus:outline-none"
            />
          </div>
          <div>
            <label className="block text-sm font-semibold text-ink mb-1">Email *</label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="admin@perusahaan.com"
              className="w-full rounded-xl border border-border-sky px-3.5 py-2.5 text-sm focus:border-primary-600 focus:outline-none"
            />
          </div>
          <div>
            <label className="block text-sm font-semibold text-ink mb-1">Password Awal *</label>
            <input
              type="password"
              required
              minLength={6}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Minimal 6 karakter"
              className="w-full rounded-xl border border-border-sky px-3.5 py-2.5 text-sm focus:border-primary-600 focus:outline-none"
            />
          </div>
          <div>
            <label className="block text-sm font-semibold text-ink mb-1">Role Akses *</label>
            <select
              value={role}
              onChange={(e) => setRole(e.target.value as 'admin' | 'absen')}
              className="w-full rounded-xl border border-border-sky px-3.5 py-2.5 text-sm focus:border-primary-600 focus:outline-none"
            >
              <option value="admin">admin — Dashboard Admin (PC)</option>
              <option value="absen">absen — Dashboard Kiosk (Tablet)</option>
            </select>
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={() => setCreateOpen(false)}
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
              <span>Buat Akun</span>
            </button>
          </div>
        </form>
      </Modal>

      <Modal
        open={Boolean(resetTarget)}
        onClose={() => setResetTarget(null)}
        title={`Reset Password: ${resetTarget?.full_name ?? ''}`}
        maxWidthClass="max-w-md"
      >
        <form onSubmit={handleResetPassword} className="space-y-4">
          <div>
            <label className="block text-sm font-semibold text-ink mb-1">Password Baru *</label>
            <input
              type="password"
              required
              minLength={6}
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="Minimal 6 karakter"
              className="w-full rounded-xl border border-border-sky px-3.5 py-2.5 text-sm focus:border-primary-600 focus:outline-none"
            />
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={() => setResetTarget(null)}
              className="rounded-xl border border-border-sky px-4 py-2.5 text-sm font-semibold"
            >
              Batal
            </button>
            <button
              type="submit"
              disabled={resetting}
              className="rounded-xl bg-primary-600 hover:bg-primary-700 disabled:opacity-60 text-white px-5 py-2.5 text-sm font-semibold flex items-center gap-2"
            >
              {resetting && <Loader2 className="w-4 h-4 animate-spin" />}
              <span>Simpan Password</span>
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}

