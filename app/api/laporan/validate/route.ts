import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { requireApiRole } from '@/lib/auth';
import { createAdminClient } from '@/lib/supabase/admin';

const validateSchema = z.object({
  attendance_id: z.string().uuid('ID absensi tidak valid.'),
  action: z.enum(['approve', 'reject']),
  notes: z.string().optional(),
});

export async function POST(req: NextRequest) {
  // Hanya role HRD dan Superadmin yang berwenang memvalidasi koreksi admin
  const auth = await requireApiRole(['hrd', 'superadmin']);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const body = (await req.json()) as Record<string, unknown>;
  const parsed = validateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.errors[0]?.message ?? 'Permintaan validasi tidak valid.' },
      { status: 400 }
    );
  }

  const { attendance_id, action, notes } = parsed.data;
  const adminClient = createAdminClient();
  const nowIso = new Date().toISOString();

  // 1. Ambil data absensi yang akan divalidasi
  const { data: row, error: findErr } = await adminClient
    .from('attendance')
    .select('*')
    .eq('id', attendance_id)
    .maybeSingle();

  if (findErr || !row) {
    return NextResponse.json({ error: 'Data absensi tidak ditemukan.' }, { status: 404 });
  }

  if (row.correction_status !== 'pending_hrd') {
    return NextResponse.json(
      { error: 'Data absensi ini tidak dalam status menunggu validasi HRD.' },
      { status: 400 }
    );
  }

  // 2. Proses Approval atau Rejection
  if (action === 'approve') {
    const { data: updated, error: updErr } = await adminClient
      .from('attendance')
      .update({
        correction_status: 'approved_hrd',
        validated_by: auth.session.userId,
        validated_at: nowIso,
        validation_notes: notes?.trim() || 'Disetujui oleh HRD',
      })
      .eq('id', attendance_id)
      .select('*')
      .single();

    if (updErr) {
      return NextResponse.json({ error: updErr.message }, { status: 500 });
    }

    await adminClient.from('audit_logs').insert({
      user_id: auth.session.userId,
      action: 'hrd_approve',
      table_name: 'attendance',
      record_id: attendance_id,
      reason: notes?.trim() || 'Validasi koreksi absensi disetujui oleh HRD',
      payload: { attendance_id, validated_by: auth.session.userId, at: nowIso },
    });

    return NextResponse.json({
      success: true,
      message: 'Koreksi absensi berhasil disetujui.',
      item: updated,
    });
  }

  // Action === 'reject': Rollback perubahan ke data sebelum koreksi
  const prev = (row.previous_data ?? null) as Record<string, unknown> | null;

  if (prev && prev.is_new === true) {
    // Jika awalnya ini adalah baris baru yang diinput admin, hapus baris atau kosongkan jam
    const { error: delErr } = await adminClient
      .from('attendance')
      .delete()
      .eq('id', attendance_id);

    if (delErr) {
      return NextResponse.json({ error: delErr.message }, { status: 500 });
    }

    await adminClient.from('audit_logs').insert({
      user_id: auth.session.userId,
      action: 'hrd_reject_delete_new',
      table_name: 'attendance',
      record_id: attendance_id,
      reason: notes?.trim() || 'Penambahan absensi susulan ditolak oleh HRD dan dihapus',
      payload: { attendance_id, rejected_by: auth.session.userId, at: nowIso },
    });

    return NextResponse.json({
      success: true,
      message: 'Koreksi penambahan data baru ditolak oleh HRD.',
      deleted: true,
    });
  }

  // Rollback ke nilai semula
  const rollbackUpdates: Record<string, unknown> = {
    correction_status: 'rejected_hrd',
    validated_by: auth.session.userId,
    validated_at: nowIso,
    validation_notes: notes?.trim() || 'Koreksi ditolak oleh HRD',
  };

  if (prev) {
    if ('masuk_at' in prev) rollbackUpdates.masuk_at = prev.masuk_at;
    if ('istirahat_at' in prev) rollbackUpdates.istirahat_at = prev.istirahat_at;
    if ('istirahat_kembali_at' in prev) rollbackUpdates.istirahat_kembali_at = prev.istirahat_kembali_at;
    if ('pulang_at' in prev) rollbackUpdates.pulang_at = prev.pulang_at;
  }

  const { data: updated, error: updErr } = await adminClient
    .from('attendance')
    .update(rollbackUpdates)
    .eq('id', attendance_id)
    .select('*')
    .single();

  if (updErr) {
    return NextResponse.json({ error: updErr.message }, { status: 500 });
  }

  await adminClient.from('audit_logs').insert({
    user_id: auth.session.userId,
    action: 'hrd_reject_rollback',
    table_name: 'attendance',
    record_id: attendance_id,
    reason: notes?.trim() || 'Koreksi ditolak oleh HRD, data dikembalikan ke nilai awal',
    payload: { attendance_id, restored_to: prev, at: nowIso },
  });

  return NextResponse.json({
    success: true,
    message: 'Koreksi ditolak dan data telah dikembalikan ke kondisi semula.',
    item: updated,
  });
}
