'use client';

import { Suspense, useState } from 'react';
import Image from 'next/image';
import { useRouter, useSearchParams } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Eye, EyeOff, Loader2, Lock, Mail, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import { createClient } from '@/lib/supabase/client';
import { loginSchema } from '@/lib/validators';
import type { z } from 'zod';

type LoginFormValues = z.infer<typeof loginSchema>;

function LoginFormContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const errorParam = searchParams.get('error');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<LoginFormValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: {
      email: '',
      password: '',
    },
  });

  const onSubmit = async (values: LoginFormValues) => {
    setSubmitting(true);
    try {
      const supabase = createClient();
      const { data, error } = await supabase.auth.signInWithPassword({
        email: values.email.trim().toLowerCase(),
        password: values.password,
      });

      if (error || !data.user) {
        toast.error('Email atau password salah.');
        setSubmitting(false);
        return;
      }

      const { data: profile, error: profileErr } = await supabase
        .from('profiles')
        .select('role, is_active, full_name')
        .eq('id', data.user.id)
        .single();

      if (profileErr || !profile) {
        await supabase.auth.signOut();
        toast.error('Profil akun belum terdaftar. Hubungi superadmin.');
        setSubmitting(false);
        return;
      }

      if (!profile.is_active) {
        await supabase.auth.signOut();
        toast.error('Akun Anda sedang dinonaktifkan. Hubungi superadmin.');
        setSubmitting(false);
        return;
      }

      toast.success(`Selamat datang, ${profile.full_name}`);
      if (profile.role === 'absen') {
        router.replace('/absen');
      } else {
        router.replace('/admin');
      }
      router.refresh();
    } catch {
      toast.error('Terjadi gangguan saat masuk. Coba lagi.');
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-page via-white to-primary-100/70 px-4 py-8">
      <div className="w-full max-w-md bg-surface rounded-2xl border border-border-sky shadow-card p-8">
        <div className="flex flex-col items-center text-center mb-8">
          <div className="w-44 h-auto mb-3">
            <Image
              src="/images/logo.jpeg"
              alt="Logo MonsClock"
              width={240}
              height={240}
              className="w-full h-auto object-contain rounded-xl"
              priority
            />
          </div>
          <p className="text-sm text-ink-muted">
            Masuk ke Dashboard Absensi Kiosk atau Panel Admin
          </p>
        </div>

        {errorParam === 'nonaktif' && (
          <div className="mb-5 rounded-xl bg-danger/10 border border-danger/30 px-4 py-3 text-sm text-danger">
            Akun Anda tidak aktif atau profil tidak ditemukan. Hubungi superadmin.
          </div>
        )}

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-5" noValidate>
          <div>
            <label htmlFor="email" className="block text-sm font-semibold text-ink mb-1.5">
              Email
            </label>
            <div className="relative">
              <Mail className="w-5 h-5 text-ink-muted absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                id="email"
                type="email"
                autoComplete="email"
                placeholder="nama@perusahaan.com"
                {...register('email')}
                className="w-full rounded-xl border border-border-sky bg-page/50 pl-11 pr-4 py-3 text-sm text-ink placeholder:text-ink-muted/60 focus:border-primary-600 focus:bg-white focus:outline-none focus:ring-2 focus:ring-primary/25 transition"
              />
            </div>
            {errors.email && (
              <p className="mt-1.5 text-xs font-medium text-danger">{errors.email.message}</p>
            )}
          </div>

          <div>
            <label htmlFor="password" className="block text-sm font-semibold text-ink mb-1.5">
              Password
            </label>
            <div className="relative">
              <Lock className="w-5 h-5 text-ink-muted absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                id="password"
                type={showPassword ? 'text' : 'password'}
                autoComplete="current-password"
                placeholder="Masukkan password"
                {...register('password')}
                className="w-full rounded-xl border border-border-sky bg-page/50 pl-11 pr-12 py-3 text-sm text-ink placeholder:text-ink-muted/60 focus:border-primary-600 focus:bg-white focus:outline-none focus:ring-2 focus:ring-primary/25 transition"
              />
              <button
                type="button"
                onClick={() => setShowPassword((prev) => !prev)}
                className="absolute right-3 top-1/2 -translate-y-1/2 p-1.5 text-ink-muted hover:text-ink transition"
                aria-label={showPassword ? 'Sembunyikan password' : 'Lihat password'}
              >
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
            {errors.password && (
              <p className="mt-1.5 text-xs font-medium text-danger">{errors.password.message}</p>
            )}
          </div>

          <button
            type="submit"
            disabled={submitting}
            className="w-full rounded-xl bg-primary-600 hover:bg-primary-700 active:scale-[0.99] disabled:opacity-60 text-white font-semibold py-3.5 px-4 shadow-soft flex items-center justify-center gap-2 transition"
          >
            {submitting ? (
              <>
                <Loader2 className="w-5 h-5 animate-spin" />
                <span>Memproses...</span>
              </>
            ) : (
              <>
                <ShieldCheck className="w-5 h-5" />
                <span>Masuk ke Sistem</span>
              </>
            )}
          </button>
        </form>

        <div className="mt-6 pt-5 border-t border-border-sky text-center text-xs text-ink-muted">
          Zona waktu operasional: <span className="font-semibold text-ink">WIB (Asia/Jakarta)</span>
        </div>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center bg-page">
          <Loader2 className="w-8 h-8 animate-spin text-primary-600" />
        </div>
      }
    >
      <LoginFormContent />
    </Suspense>
  );
}

