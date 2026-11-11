import { NextResponse, type NextRequest } from 'next/server';
import { requireApiRole } from '@/lib/auth';
import { createAdminClient } from '@/lib/supabase/admin';
import { attendanceScanSchema } from '@/lib/validators';
import {
  formatWibDateFull,
  formatWibTimeSeconds,
  formatWibTimeShort,
  getWibDateString,
} from '@/lib/time';

export async function POST(req: NextRequest) {
  const auth = await requireApiRole(['absen']);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const body = (await req.json()) as Record<string, unknown>;
  const parsed = attendanceScanSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.errors[0]?.message ?? 'Permintaan absen tidak valid.' },
      { status: 400 }
    );
  }

  const { employee_id, mode, match_distance } = parsed.data;
  const adminClient = createAdminClient();

  const { data: employee, error: empErr } = await adminClient
    .from('employees')
    .select('id, name, position, is_active')
    .eq('id', employee_id)
    .single();

  if (empErr || !employee || !employee.is_active) {
    return NextResponse.json(
      { error: 'Data karyawan tidak ditemukan atau tidak aktif.' },
      { status: 404 }
    );
  }

  // Selalu gunakan waktu server (UTC) agar jam perangkat tidak bisa dimanipulasi
  const now = new Date();
  const nowIso = now.toISOString();
  const todayWib = getWibDateString(now);
  const twentyFourHoursAgoIso = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();

  if (mode === 'masuk') {
    const { data: existingToday } = await adminClient
      .from('attendance')
      .select('id, masuk_at')
      .eq('employee_id', employee_id)
      .eq('work_date', todayWib)
      .maybeSingle();

    if (existingToday?.masuk_at) {
      return NextResponse.json(
        {
          duplicate: true,
          error: `Sudah absen masuk pukul ${formatWibTimeShort(existingToday.masuk_at)} WIB`,
          employeeName: employee.name,
        },
        { status: 409 }
      );
    }

    const { data: upserted, error: upsertErr } = await adminClient
      .from('attendance')
      .upsert(
        {
          employee_id,
          work_date: todayWib,
          masuk_at: nowIso,
        },
        { onConflict: 'employee_id,work_date' }
      )
      .select('id')
      .single();

    if (upsertErr) {
      return NextResponse.json({ error: upsertErr.message }, { status: 500 });
    }

    await adminClient.from('attendance_events').insert({
      employee_id,
      attendance_id: upserted.id,
      event_type: 'masuk',
      occurred_at: nowIso,
      match_distance,
    });

    return NextResponse.json({
      success: true,
      mode,
      employee: { id: employee.id, name: employee.name, position: employee.position },
      occurredAt: nowIso,
      formattedDate: formatWibDateFull(now),
      formattedTime: formatWibTimeSeconds(now),
    });
  }

  if (mode === 'istirahat') {
    const { data: activeShift } = await adminClient
      .from('attendance')
      .select('id, masuk_at, istirahat_at, pulang_at')
      .eq('employee_id', employee_id)
      .not('masuk_at', 'is', null)
      .is('pulang_at', null)
      .gte('masuk_at', twentyFourHoursAgoIso)
      .order('masuk_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!activeShift) {
      return NextResponse.json(
        {
          error: 'Belum ada absen Masuk yang aktif. Silakan absen Masuk terlebih dahulu.',
          employeeName: employee.name,
        },
        { status: 400 }
      );
    }

    if (activeShift.istirahat_at) {
      return NextResponse.json(
        {
          duplicate: true,
          error: `Sudah absen istirahat pukul ${formatWibTimeShort(activeShift.istirahat_at)} WIB`,
          employeeName: employee.name,
        },
        { status: 409 }
      );
    }

    const { error: updateErr } = await adminClient
      .from('attendance')
      .update({ istirahat_at: nowIso })
      .eq('id', activeShift.id);

    if (updateErr) {
      return NextResponse.json({ error: updateErr.message }, { status: 500 });
    }

    await adminClient.from('attendance_events').insert({
      employee_id,
      attendance_id: activeShift.id,
      event_type: 'istirahat',
      occurred_at: nowIso,
      match_distance,
    });

    return NextResponse.json({
      success: true,
      mode,
      employee: { id: employee.id, name: employee.name, position: employee.position },
      occurredAt: nowIso,
      formattedDate: formatWibDateFull(now),
      formattedTime: formatWibTimeSeconds(now),
    });
  }

  // mode === 'pulang' (mendukung shift melewati tengah malam hingga 24 jam ke belakang)
  const { data: openShift } = await adminClient
    .from('attendance')
    .select('id, masuk_at, pulang_at')
    .eq('employee_id', employee_id)
    .not('masuk_at', 'is', null)
    .is('pulang_at', null)
    .gte('masuk_at', twentyFourHoursAgoIso)
    .order('masuk_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!openShift) {
    const { data: todayRow } = await adminClient
      .from('attendance')
      .select('pulang_at')
      .eq('employee_id', employee_id)
      .eq('work_date', todayWib)
      .maybeSingle();

    if (todayRow?.pulang_at) {
      return NextResponse.json(
        {
          duplicate: true,
          error: `Sudah absen pulang pukul ${formatWibTimeShort(todayRow.pulang_at)} WIB`,
          employeeName: employee.name,
        },
        { status: 409 }
      );
    }

    return NextResponse.json(
      {
        error: 'Belum ditemukan absen Masuk yang aktif (maksimal 24 jam terakhir). Silakan absen Masuk terlebih dahulu.',
        employeeName: employee.name,
      },
      { status: 400 }
    );
  }

  const { error: pulangErr } = await adminClient
    .from('attendance')
    .update({ pulang_at: nowIso })
    .eq('id', openShift.id);

  if (pulangErr) {
    return NextResponse.json({ error: pulangErr.message }, { status: 500 });
  }

  await adminClient.from('attendance_events').insert({
    employee_id,
    attendance_id: openShift.id,
    event_type: 'pulang',
    occurred_at: nowIso,
    match_distance,
  });

  return NextResponse.json({
    success: true,
    mode,
    employee: { id: employee.id, name: employee.name, position: employee.position },
    occurredAt: nowIso,
    formattedDate: formatWibDateFull(now),
    formattedTime: formatWibTimeSeconds(now),
  });
}

