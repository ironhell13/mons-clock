import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

const PERSISTENT_COOKIE_MAX_AGE = 60 * 60 * 24 * 365; // 1 tahun untuk sesi kiosk tablet awet

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({
    request: {
      headers: request.headers,
    },
  });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    return response;
  }

  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({
          request: {
            headers: request.headers,
          },
        });
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, {
            ...options,
            maxAge: options?.maxAge ?? PERSISTENT_COOKIE_MAX_AGE,
          })
        );
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const pathname = request.nextUrl.pathname;
  const isLoginRoute = pathname.startsWith('/login');
  const isAdminRoute = pathname.startsWith('/admin');
  const isAdminUsersRoute = pathname.startsWith('/admin/users');
  const isAbsenRoute = pathname.startsWith('/absen');
  const isApiRoute = pathname.startsWith('/api');

  if (isApiRoute) {
    return response;
  }

  if (!user) {
    if (isAdminRoute || isAbsenRoute || pathname === '/') {
      const loginUrl = request.nextUrl.clone();
      loginUrl.pathname = '/login';
      return NextResponse.redirect(loginUrl);
    }
    return response;
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('role, is_active')
    .eq('id', user.id)
    .single();

  if (!profile || !profile.is_active) {
    if (!isLoginRoute) {
      const loginUrl = request.nextUrl.clone();
      loginUrl.pathname = '/login';
      loginUrl.searchParams.set('error', 'nonaktif');
      return NextResponse.redirect(loginUrl);
    }
    return response;
  }

  const role = profile.role as 'superadmin' | 'admin' | 'absen';
  const homePath = role === 'absen' ? '/absen' : '/admin';

  if (pathname === '/' || isLoginRoute) {
    const dest = request.nextUrl.clone();
    dest.pathname = homePath;
    dest.search = '';
    return NextResponse.redirect(dest);
  }

  if (isAbsenRoute && role !== 'absen') {
    const dest = request.nextUrl.clone();
    dest.pathname = '/admin';
    return NextResponse.redirect(dest);
  }

  if (isAdminUsersRoute && role !== 'superadmin') {
    const dest = request.nextUrl.clone();
    dest.pathname = role === 'absen' ? '/absen' : '/admin';
    return NextResponse.redirect(dest);
  }

  if (isAdminRoute && role !== 'admin' && role !== 'superadmin') {
    const dest = request.nextUrl.clone();
    dest.pathname = '/absen';
    return NextResponse.redirect(dest);
  }

  return response;
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|images/|models/|mediapipe/|.*\\.(?:svg|png|jpg|jpeg|gif|webp|wasm|bin|json|task)$).*)',
  ],
};

