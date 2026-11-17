import { NextResponse, type NextRequest } from 'next/server';
import { requireApiRole } from '@/lib/auth';
import { createAdminClient } from '@/lib/supabase/admin';
import { voidAttendanceSchema } from '@/lib/validators';
import { getActiveFaceConfig } from '@/lib/face-config';

export async function POST(req: NextRequest) {
  const auth = await requireApiRole(['absen', 'admin', 'superadmin']);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const body = (await req.json()) as Record<string, unknown>;
  const parsed = voidAttendanceSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.errors[0]?.message ?? 'Permintaan pembatalan tidak valid.' },
      { status: 400 }
    );
  }

  const { event_id, reason } = parsed.data;
  const config = getActiveFaceConfig();
  const adminClient = createAdminClient();
  const now = new Date();
  const nowIso = now.toISOString();

  // 1. Ambil data event
  const { data: eventRow, error: evErr } = await adminClient
    .from('attendance_events')
    .select('*')
    .eq('id', event_id)
    .maybeSingle();

  if (evErr || !eventRow) {
    return NextResponse.json(
      { error: 'Data absensi tidak ditemukan.' },
      { status: 404 }
    );
  }

  if (eventRow.voided_at) {
    return NextResponse.json(
      { error: 'Absensi ini sudah dibatalkan sebelumnya.' },
      { status: 400 }
    );
  }

  // 2. Cek jendela waktu pembatalan (UNDO_WINDOW_SEC, default 180 detik)
  const eventTime = new Date(eventRow.occurred_at).getTime();
  const elapsedSec = (now.getTime() - eventTime) / 1000;
  if (elapsedSec > config.UNDO_WINDOW_SEC) {
    return NextResponse.json(
      {
        error: `Batas waktu pembatalan mandiri telah habis (${Math.round(elapsedSec)}s > ${config.UNDO_WINDOW_SEC}s). Silakan hubungi admin untuk koreksi.`,
      },
      { status: 403 }
    );
  }

  // 3. Pastikan merupakan event terbaru dari karyawan ini
  const { data: latestEvent } = await adminClient
    .from('attendance_events')
    .select('id')
    .eq('employee_id', eventRow.employee_id)
    .is('voided_at', null)
    .order('occurred_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (latestEvent && latestEvent.id !== event_id) {
    return NextResponse.json(
      { error: 'Hanya absensi paling akhir yang dapat dibatalkan.' },
      { status: 400 }
    );
  }

  // 4. Kembalikan tabel attendance ke before_state
  if (eventRow.attendance_id) {
    const beforeState = eventRow.before_state as {
      masuk_at?: string | null;
      istirahat_at?: string | null;
      istirahat_kembali_at?: string | null;
      pulang_at?: string | null;
    } | null;

    if (!beforeState || !beforeState.masuk_at) {
      // Jika event adalah absen masuk baru (sebelumnya belum ada row masuk), hapus baris attendance
      await adminClient
        .from('attendance')
        .delete()
        .eq('id', eventRow.attendance_id);
    } else {
      // Rollback kolom-kolom attendance ke keadaan semula sebelum event
      await adminClient
        .from('attendance')
        .update({
          masuk_at: beforeState.masuk_at ?? null,
          istirahat_at: beforeState.istirahat_at ?? null,
          istirahat_kembali_at: beforeState.istirahat_kembali_at ?? null,
          pulang_at: beforeState.pulang_at ?? null,
        })
        .eq('id', eventRow.attendance_id);
    }
  }

  // 5. Tandai event sebagai voided
  await adminClient
    .from('attendance_events')
    .update({
      voided_at: nowIso,
      void_reason: reason,
    })
    .eq('id', event_id);

  // 6. Catat ke audit log
  await adminClient.from('audit_logs').insert({
    user_id: auth.session.userId,
    action: 'attendance_voided',
    table_name: 'attendance_events',
    record_id: event_id,
    reason: `Pembatalan "Bukan saya": ${reason}`,
    payload: {
      employee_id: eventRow.employee_id,
      event_type: eventRow.event_type,
      occurred_at: eventRow.occurred_at,
    },
  });

  return NextResponse.json({
    success: true,
    message: 'Absensi berhasil dibatalkan. Data telah dikembalikan ke kondisi semula.',
  });
}

