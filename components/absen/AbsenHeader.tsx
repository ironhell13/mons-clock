'use client';

import { useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { LogOut, Maximize2, Minimize2, ScanFace } from 'lucide-react';
import { toast } from 'sonner';
import { createClient } from '@/lib/supabase/client';
import { ClockWib } from '@/components/ui/ClockWib';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';

export function AbsenHeader() {
  const router = useRouter();
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [logoutConfirm, setLogoutConfirm] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);

  const toggleFullscreen = async () => {
    try {
      if (!document.fullscreenElement) {
        await document.documentElement.requestFullscreen();
        setIsFullscreen(true);
      } else {
        await document.exitFullscreen();
        setIsFullscreen(false);
      }
    } catch {
      toast.info('Mode layar penuh tidak didukung di browser ini.');
    }
  };

  const handleLogout = async () => {
    setLoggingOut(true);
    try {
      const supabase = createClient();
      await supabase.auth.signOut();
      router.replace('/login');
      router.refresh();
    } catch {
      toast.error('Gagal keluar dari perangkat kiosk.');
    } finally {
      setLoggingOut(false);
      setLogoutConfirm(false);
    }
  };

  return (
    <>
      <header className="bg-surface/95 backdrop-blur border-b border-border-sky px-4 sm:px-6 lg:px-8 py-3 flex flex-wrap items-center justify-between gap-3 shadow-sm">
        <Link href="/absen" className="flex items-center gap-3 shrink-0">
          <Image
            src="/images/logo.jpeg"
            alt="MonsClock"
            width={160}
            height={52}
            className="h-10 sm:h-12 w-auto object-contain"
            priority
          />
        </Link>

        <div className="flex flex-wrap items-center gap-3 lg:gap-5">
          <ClockWib />

          <Link
            href="/absen/daftar-wajah"
            className="flex items-center gap-2.5 rounded-2xl bg-primary-50 hover:bg-primary-100 border-2 border-primary-200 px-3.5 py-2 shadow-soft transition active:scale-95 min-h-[50px]"
          >
            <div className="w-8 h-8 rounded-xl bg-primary-600 text-white flex items-center justify-center shrink-0">
              <ScanFace className="w-4 h-4" />
            </div>
            <div className="text-left leading-tight">
              <div className="text-xs sm:text-sm font-bold text-ink">Daftar Wajah</div>
              <div className="text-[11px] font-medium text-ink-muted hidden sm:block">
                Registrasi baru
              </div>
            </div>
          </Link>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={toggleFullscreen}
              className="p-3 rounded-xl border border-border-sky bg-white hover:bg-page text-ink-muted hover:text-ink transition"
              title="Layar penuh"
              aria-label="Toggle layar penuh"
            >
              {isFullscreen ? (
                <Minimize2 className="w-5 h-5" />
              ) : (
                <Maximize2 className="w-5 h-5" />
              )}
            </button>
            <button
              type="button"
              onClick={() => setLogoutConfirm(true)}
              className="p-3 rounded-xl border border-border-sky bg-white hover:bg-danger/5 hover:border-danger/30 text-ink-muted hover:text-danger transition"
              title="Keluar akun perangkat"
              aria-label="Keluar akun perangkat"
            >
              <LogOut className="w-5 h-5" />
            </button>
          </div>
        </div>
      </header>

      <ConfirmDialog
        open={logoutConfirm}
        onClose={() => setLogoutConfirm(false)}
        onConfirm={handleLogout}
        loading={loggingOut}
        title="Keluar dari Mode Kiosk?"
        message="Perangkat tablet ini akan keluar dari sesi absen. Anda harus login ulang untuk memakai kiosk."
        confirmLabel="Keluar Kiosk"
        variant="danger"
      />
    </>
  );
}

