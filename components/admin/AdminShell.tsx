'use client';

import { useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { usePathname, useRouter } from 'next/navigation';
import {
  Building2,
  Car,
  ClipboardList,
  FileSpreadsheet,
  LayoutDashboard,
  LogOut,
  MapPin,
  Menu,
  Package,
  ScanFace,
  Shield,
  Truck,
  UserCheck,
  UserCog,
  Users,
  Wrench,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import { createClient } from '@/lib/supabase/client';
import { ClockWib } from '@/components/ui/ClockWib';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import type { Profile } from '@/types/database';

interface NavGroup {
  label: string;
  items: {
    href: string;
    label: string;
    icon: React.ComponentType<{ className?: string }>;
    superadminOnly?: boolean;
  }[];
}

const NAV_GROUPS: NavGroup[] = [
  {
    label: 'Utama',
    items: [{ href: '/admin', label: 'Ringkasan', icon: LayoutDashboard }],
  },
  {
    label: 'Data Master',
    items: [
      { href: '/admin/master/karyawan', label: 'Karyawan', icon: Users },
      { href: '/admin/master/pengawal', label: 'Pengawal', icon: Shield },
      { href: '/admin/master/area', label: 'Area', icon: MapPin },
      { href: '/admin/master/nopol', label: 'Nopol', icon: Car },
      { href: '/admin/master/bengkel', label: 'Bengkel', icon: Building2 },
    ],
  },
  {
    label: 'Mutasi Operasional',
    items: [
      { href: '/admin/mutasi/tamu', label: 'Mutasi Tamu', icon: UserCheck },
      { href: '/admin/mutasi/bengkel', label: 'Mutasi Bengkel', icon: Wrench },
      { href: '/admin/mutasi/barang', label: 'Mutasi Barang', icon: Package },
    ],
  },
  {
    label: 'Laporan & Audit',
    items: [
      { href: '/admin/laporan/karyawan', label: 'Mutasi Karyawan', icon: ClipboardList },
      { href: '/admin/laporan/flm', label: 'Mutasi FLM', icon: FileSpreadsheet },
      { href: '/admin/laporan/rpl', label: 'Mutasi RPL', icon: Truck },
      { href: '/admin/laporan/cit', label: 'Mutasi CIT', icon: Truck },
    ],
  },
  {
    label: 'Pengaturan',
    items: [
      { href: '/admin/wajah', label: 'Kelola Wajah', icon: ScanFace },
      { href: '/admin/users', label: 'Manajemen User', icon: UserCog, superadminOnly: true },
    ],
  },
];

export function AdminShell({
  profile,
  children,
}: {
  profile: Profile;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [logoutConfirm, setLogoutConfirm] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);

  const handleLogout = async () => {
    setLoggingOut(true);
    try {
      const supabase = createClient();
      await supabase.auth.signOut();
      toast.success('Anda berhasil keluar.');
      router.replace('/login');
      router.refresh();
    } catch {
      toast.error('Gagal keluar dari sesi.');
    } finally {
      setLoggingOut(false);
      setLogoutConfirm(false);
    }
  };

  const renderNav = () => (
    <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-5">
      {NAV_GROUPS.map((group) => {
        const visibleItems = group.items.filter(
          (item) => !item.superadminOnly || profile.role === 'superadmin'
        );
        if (visibleItems.length === 0) return null;

        return (
          <div key={group.label}>
            <div className="px-3 mb-1.5 text-[11px] font-bold uppercase tracking-wider text-ink-muted/80">
              {group.label}
            </div>
            <div className="space-y-1">
              {visibleItems.map((item) => {
                const Icon = item.icon;
                const active =
                  item.href === '/admin'
                    ? pathname === '/admin'
                    : pathname.startsWith(item.href);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => setSidebarOpen(false)}
                    className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold transition ${
                      active
                        ? 'bg-primary-100 text-primary-700 shadow-sm'
                        : 'text-ink-muted hover:bg-page hover:text-ink'
                    }`}
                  >
                    <Icon className={`w-4 h-4 shrink-0 ${active ? 'text-primary-600' : ''}`} />
                    <span>{item.label}</span>
                  </Link>
                );
              })}
            </div>
          </div>
        );
      })}
    </nav>
  );

  return (
    <div className="min-h-screen flex bg-page">
      {/* Desktop Sidebar */}
      <aside className="hidden lg:flex lg:w-64 lg:flex-col lg:fixed lg:inset-y-0 bg-surface border-r border-border-sky z-30">
        <div className="h-16 px-4 flex items-center gap-3 border-b border-border-sky">
          <Image
            src="/images/logo.jpeg"
            alt="MonsClock"
            width={140}
            height={44}
            className="h-10 w-auto object-contain"
          />
        </div>
        {renderNav()}
        <div className="p-3 border-t border-border-sky text-xs text-ink-muted text-center">
          MonsClock Pos Security
        </div>
      </aside>

      {/* Mobile Drawer */}
      {sidebarOpen && (
        <div className="fixed inset-0 z-50 lg:hidden flex">
          <div
            className="fixed inset-0 bg-ink/40 backdrop-blur-sm"
            onClick={() => setSidebarOpen(false)}
          />
          <aside className="relative w-72 max-w-[85vw] bg-surface h-full flex flex-col border-r border-border-sky shadow-card z-10">
            <div className="h-16 px-4 flex items-center justify-between border-b border-border-sky">
              <Image
                src="/images/logo.jpeg"
                alt="MonsClock"
                width={140}
                height={44}
                className="h-10 w-auto object-contain"
              />
              <button
                type="button"
                onClick={() => setSidebarOpen(false)}
                className="p-2 rounded-xl text-ink-muted hover:bg-page"
                aria-label="Tutup menu"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            {renderNav()}
          </aside>
        </div>
      )}

      {/* Main content area */}
      <div className="flex-1 lg:pl-64 flex flex-col min-w-0">
        <header className="sticky top-0 z-20 h-16 bg-surface/95 backdrop-blur border-b border-border-sky px-4 lg:px-8 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setSidebarOpen(true)}
              className="lg:hidden p-2 rounded-xl border border-border-sky text-ink hover:bg-page"
              aria-label="Buka menu navigasi"
            >
              <Menu className="w-5 h-5" />
            </button>
            <div className="hidden md:block">
              <ClockWib compact />
            </div>
          </div>

          <div className="flex items-center gap-3">
            <div className="text-right">
              <div className="text-sm font-bold text-ink leading-tight">{profile.full_name}</div>
              <div className="text-xs font-semibold text-primary-700 capitalize">
                {profile.role === 'superadmin' ? 'Superadmin' : 'Admin'}
              </div>
            </div>
            <button
              type="button"
              onClick={() => setLogoutConfirm(true)}
              className="inline-flex items-center gap-2 rounded-xl border border-border-sky bg-white hover:bg-danger/5 hover:border-danger/30 hover:text-danger px-3.5 py-2 text-sm font-semibold text-ink transition"
            >
              <LogOut className="w-4 h-4" />
              <span className="hidden sm:inline">Keluar</span>
            </button>
          </div>
        </header>

        <main className="flex-1 p-4 lg:p-8 max-w-[1440px] w-full mx-auto">{children}</main>
      </div>

      <ConfirmDialog
        open={logoutConfirm}
        onClose={() => setLogoutConfirm(false)}
        onConfirm={handleLogout}
        loading={loggingOut}
        title="Konfirmasi Keluar"
        message="Apakah Anda yakin ingin keluar dari Dashboard Admin MonsClock?"
        confirmLabel="Ya, Keluar"
        variant="danger"
      />
    </div>
  );
}

