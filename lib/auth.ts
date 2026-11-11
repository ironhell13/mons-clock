import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import type { Profile, UserRole } from '@/types/database';

export async function getCurrentSessionProfile(): Promise<{
  userId: string;
  email: string | null;
  profile: Profile;
} | null> {
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return null;
  }

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .single();

  if (profileError || !profile || !profile.is_active) {
    return null;
  }

  return {
    userId: user.id,
    email: user.email ?? profile.email ?? null,
    profile: profile as Profile,
  };
}

export async function requirePageRole(allowedRoles: UserRole[]): Promise<{
  userId: string;
  email: string | null;
  profile: Profile;
}> {
  const session = await getCurrentSessionProfile();
  if (!session) {
    redirect('/login');
  }
  if (!allowedRoles.includes(session.profile.role)) {
    if (session.profile.role === 'absen') {
      redirect('/absen');
    }
    redirect('/admin');
  }
  return session;
}

export async function requireApiRole(allowedRoles: UserRole[]) {
  const session = await getCurrentSessionProfile();
  if (!session) {
    return {
      ok: false as const,
      status: 401,
      error: 'Sesi berakhir. Silakan login kembali.',
    };
  }
  if (!allowedRoles.includes(session.profile.role)) {
    return {
      ok: false as const,
      status: 403,
      error: 'Anda tidak memiliki izin untuk aksi ini.',
    };
  }
  return {
    ok: true as const,
    session,
  };
}

