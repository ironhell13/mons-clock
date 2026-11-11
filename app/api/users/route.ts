import { NextResponse, type NextRequest } from 'next/server';
import { requireApiRole } from '@/lib/auth';
import { createAdminClient } from '@/lib/supabase/admin';
import { createUserSchema, updateUserSchema } from '@/lib/validators';

export async function GET() {
  const auth = await requireApiRole(['superadmin']);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const adminClient = createAdminClient();
  const { data, error } = await adminClient
    .from('profiles')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    items: data ?? [],
    currentUserId: auth.session.userId,
  });
}

export async function POST(req: NextRequest) {
  const auth = await requireApiRole(['superadmin']);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const body = (await req.json()) as Record<string, unknown>;
  const parsed = createUserSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.errors[0]?.message ?? 'Data user tidak valid.' },
      { status: 400 }
    );
  }

  const { full_name, email, password, role } = parsed.data;
  const normalizedEmail = email.trim().toLowerCase();
  const adminClient = createAdminClient();

  const { data: createdUser, error: createErr } = await adminClient.auth.admin.createUser({
    email: normalizedEmail,
    password,
    email_confirm: true,
    user_metadata: { full_name },
  });

  if (createErr || !createdUser.user) {
    const msg = createErr?.message?.toLowerCase().includes('already')
      ? 'Email sudah terdaftar.'
      : createErr?.message ?? 'Gagal membuat akun user.';
    return NextResponse.json({ error: msg }, { status: 400 });
  }

  const { data: profile, error: profileErr } = await adminClient
    .from('profiles')
    .upsert(
      {
        id: createdUser.user.id,
        email: normalizedEmail,
        full_name,
        role,
        is_active: true,
      },
      { onConflict: 'id' }
    )
    .select('*')
    .single();

  if (profileErr) {
    return NextResponse.json({ error: profileErr.message }, { status: 500 });
  }

  await adminClient.from('audit_logs').insert({
    user_id: auth.session.userId,
    action: 'create_user',
    table_name: 'profiles',
    record_id: createdUser.user.id,
    payload: { email: normalizedEmail, full_name, role },
  });

  return NextResponse.json({ item: profile }, { status: 201 });
}

export async function PATCH(req: NextRequest) {
  const auth = await requireApiRole(['superadmin']);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const body = (await req.json()) as Record<string, unknown>;
  const parsed = updateUserSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.errors[0]?.message ?? 'Permintaan pembaruan user tidak valid.' },
      { status: 400 }
    );
  }

  const { user_id, role, is_active, new_password } = parsed.data;
  const adminClient = createAdminClient();

  if (user_id === auth.session.userId) {
    if (is_active === false || (role && role !== 'superadmin')) {
      return NextResponse.json(
        { error: 'Superadmin tidak dapat menonaktifkan atau menurunkan role dirinya sendiri.' },
        { status: 400 }
      );
    }
  }

  if (new_password) {
    const { error: pwdErr } = await adminClient.auth.admin.updateUserById(user_id, {
      password: new_password,
    });
    if (pwdErr) {
      return NextResponse.json({ error: pwdErr.message }, { status: 400 });
    }
  }

  const updates: Record<string, unknown> = {};
  if (role !== undefined) updates.role = role;
  if (is_active !== undefined) updates.is_active = is_active;

  let updatedProfile = null;
  if (Object.keys(updates).length > 0) {
    const { data, error: updErr } = await adminClient
      .from('profiles')
      .update(updates)
      .eq('id', user_id)
      .select('*')
      .single();

    if (updErr) {
      return NextResponse.json({ error: updErr.message }, { status: 400 });
    }
    updatedProfile = data;
  }

  await adminClient.from('audit_logs').insert({
    user_id: auth.session.userId,
    action: new_password ? 'reset_user_password' : 'update_user',
    table_name: 'profiles',
    record_id: user_id,
    payload: { ...updates, password_reset: Boolean(new_password) },
  });

  return NextResponse.json({ item: updatedProfile, success: true });
}

