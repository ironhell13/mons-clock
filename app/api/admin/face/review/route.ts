import { NextResponse, type NextRequest } from 'next/server';
import { requireApiRole } from '@/lib/auth';
import { createAdminClient } from '@/lib/supabase/admin';

export async function GET(req: NextRequest) {
  const auth = await requireApiRole(['admin', 'superadmin']);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const { searchParams } = new URL(req.url);
  const filter = searchParams.get('filter') || 'all'; // 'all' | 'confirm' | 'low_margin' | 'voided'
  const limit = Math.min(100, Math.max(10, parseInt(searchParams.get('limit') || '50', 10)));

  const adminClient = createAdminClient();

  let query = adminClient
    .from('attendance_events')
    .select(
      `
      id,
      attendance_id,
      employee_id,
      event_type,
      event_time,
      match_distance,
      second_subject_id,
      second_distance,
      margin,
      decision_zone,
      frames_used,
      verification_id,
      voided_at,
      void_reason,
      created_at,
      employee:employees!attendance_events_employee_id_fkey(id, name, employee_no),
      second_employee:employees!attendance_events_second_subject_id_fkey(id, name, employee_no),
      verification:face_verifications(id, confirmed_method, confirm_attempts)
    `
    )
    .order('created_at', { ascending: false })
    .limit(limit);

  if (filter === 'confirm') {
    query = query.eq('decision_zone', 'confirm');
  } else if (filter === 'low_margin') {
    query = query.lt('margin', 0.10);
  } else if (filter === 'voided') {
    query = query.not('voided_at', 'is', null);
  }

  const { data: events, error } = await query;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Ringkasan 7 hari terakhir
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const [confirmCountRes, voidedCountRes] = await Promise.all([
    adminClient
      .from('attendance_events')
      .select('*', { count: 'exact', head: true })
      .eq('decision_zone', 'confirm')
      .gte('created_at', sevenDaysAgo),
    adminClient
      .from('attendance_events')
      .select('*', { count: 'exact', head: true })
      .not('voided_at', 'is', null)
      .gte('created_at', sevenDaysAgo),
  ]);

  return NextResponse.json({
    events: events ?? [],
    stats_7d: {
      confirm_count: confirmCountRes.count ?? 0,
      voided_count: voidedCountRes.count ?? 0,
    },
  });
}

export async function POST(req: NextRequest) {
  const auth = await requireApiRole(['admin', 'superadmin']);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const body = (await req.json()) as {
    event_id?: string;
    action?: 'mark_valid' | 'correct_person';
    correct_employee_id?: string;
    reason?: string;
  };

  const { event_id, action, correct_employee_id, reason } = body;
  if (!event_id || !action) {
    return NextResponse.json({ error: 'Data review tidak lengkap.' }, { status: 400 });
  }

  const adminClient = createAdminClient();

  const { data: event, error: eventErr } = await adminClient
    .from('attendance_events')
    .select('*, attendance(*)')
    .eq('id', event_id)
    .single();

  if (eventErr || !event) {
    return NextResponse.json({ error: 'Event absensi tidak ditemukan.' }, { status: 404 });
  }

  if (action === 'mark_valid') {
    await adminClient.from('audit_logs').insert({
      user_id: auth.session.userId,
      action: 'review_attendance_valid',
      table_name: 'attendance_events',
      record_id: event_id,
      payload: {
        admin_email: auth.session.profile.email,
        note: reason ?? 'Ditinjau dan dikonfirmasi valid oleh admin.',
      },
    });

    return NextResponse.json({ success: true, message: 'Event ditandai valid.' });
  }

  if (action === 'correct_person') {
    if (!correct_employee_id || !reason || reason.trim().length < 5) {
      return NextResponse.json(
        { error: 'Karyawan yang benar dan alasan (min 5 karakter) wajib diisi.' },
        { status: 400 }
      );
    }

    // 1. Batalkan absensi salah orang ini
    await adminClient
      .from('attendance_events')
      .update({
        voided_at: new Date().toISOString(),
        void_reason: `Koreksi admin: ${reason.trim()} (dipindahkan ke karyawan baru)`,
      })
      .eq('id', event_id);

    // 2. Kembalikan baris attendance lama ke before_state jika ada
    if (event.before_state && event.attendance_id) {
      await adminClient
        .from('attendance')
        .update(event.before_state)
        .eq('id', event.attendance_id);
    }

    // 3. Catat event koreksi untuk karyawan yang benar
    const att = event.attendance;
    if (att) {
      const workDate = att.work_date;
      // Dapatkan atau buat attendance untuk karyawan yang benar pada tanggal tersebut
      const { data: targetAtt } = await adminClient
        .from('attendance')
        .select('*')
        .eq('employee_id', correct_employee_id)
        .eq('work_date', workDate)
        .maybeSingle();

      const timeField =
        event.event_type === 'masuk'
          ? 'masuk_at'
          : event.event_type === 'istirahat'
            ? 'istirahat_at'
            : event.event_type === 'istirahat_kembali'
              ? 'istirahat_kembali_at'
              : 'pulang_at';

      if (targetAtt) {
        await adminClient
          .from('attendance')
          .update({ [timeField]: event.event_time })
          .eq('id', targetAtt.id);
      } else {
        await adminClient.from('attendance').insert({
          employee_id: correct_employee_id,
          work_date: workDate,
          [timeField]: event.event_time,
        });
      }
    }

    // 4. Catat di audit_logs
    await adminClient.from('audit_logs').insert({
      user_id: auth.session.userId,
      action: 'correct_attendance_person',
      table_name: 'attendance_events',
      record_id: event_id,
      payload: {
        from_employee_id: event.employee_id,
        to_employee_id: correct_employee_id,
        reason: reason.trim(),
        admin_email: auth.session.profile.email,
      },
    });

    return NextResponse.json({
      success: true,
      message: 'Absensi berhasil dikoreksi dan dialihkan ke karyawan yang tepat.',
    });
  }

  return NextResponse.json({ error: 'Aksi tidak dikenal.' }, { status: 400 });
}
