import { NextResponse, type NextRequest } from 'next/server';
import { requireApiRole } from '@/lib/auth';
import { createAdminClient } from '@/lib/supabase/admin';
import { resetFaceTemplatesSchema } from '@/lib/validators';

export async function POST(req: NextRequest) {
  const auth = await requireApiRole(['admin', 'superadmin']);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const body = (await req.json()) as Record<string, unknown>;
  const parsed = resetFaceTemplatesSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.errors[0]?.message ?? 'Konfirmasi tidak valid.' },
      { status: 400 }
    );
  }

  const adminClient = createAdminClient();

  // Hitung jumlah template yang akan dihapus
  const { count: templateCount } = await adminClient
    .from('face_templates')
    .select('*', { count: 'exact', head: true });

  // Hapus semua template wajah
  const { error: deleteErr } = await adminClient
    .from('face_templates')
    .delete()
    .neq('id', '00000000-0000-0000-0000-000000000000'); // hapus seluruh baris

  if (deleteErr) {
    return NextResponse.json(
      { error: `Gagal me-reset template: ${deleteErr.message}` },
      { status: 500 }
    );
  }

  // Catat di audit_logs
  await adminClient.from('audit_logs').insert({
    user_id: auth.session.userId,
    action: 'reset_all_face_templates',
    table_name: 'face_templates',
    payload: {
      deleted_count: templateCount ?? 0,
      admin_name: auth.session.profile.full_name,
      admin_email: auth.session.profile.email,
    },
  });

  return NextResponse.json({
    success: true,
    deleted_count: templateCount ?? 0,
    message: `Berhasil me-reset ${templateCount ?? 0} template wajah. Semua karyawan/pengawal perlu mendaftar ulang dengan pipeline v2.`,
  });
}

