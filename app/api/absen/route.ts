import { NextResponse, type NextRequest } from 'next/server';
import { requireApiRole } from '@/lib/auth';
import { createAdminClient } from '@/lib/supabase/admin';
import { attendanceScanSchema } from '@/lib/validators';
import { consumeVerification } from '@/lib/face-verify';
import {
  formatMinutesHuman,
  formatWibDateFull,
  formatWibTimeSeconds,
  formatWibTimeShort,
  getWibDateString,
} from '@/lib/time';

export async function POST(req: NextRequest) {
  const auth = await requireApiRole(['absen', 'admin', 'hrd', 'superadmin']);
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

  const { verification_id, mode } = parsed.data;
  const adminClient = createAdminClient();

  // 1. Verifikasi Identitas Secara Terpusat di Server (Single-Use Token)
  const verifRes = await consumeVerification(adminClient, {
    verificationId: verification_id,
    kioskUserId: auth.session.userId,
    purpose: 'absen',
    consume: true,
  });

  if (!verifRes.ok) {
    return NextResponse.json({ error: verifRes.error }, { status: verifRes.status });
  }

  const verification = verifRes.verification;
  const subject = verifRes.subject;
  const isEscort = verification.subject_type === 'escort';
  const employee_id = isEscort ? null : subject.id;
  const escort_id = isEscort ? subject.id : null;
  const subject_type: 'employee' | 'escort' = isEscort ? 'escort' : 'employee';

  // Selalu gunakan waktu server (UTC) agar jam perangkat tidak bisa dimanipulasi
  const now = new Date();
  const nowIso = now.toISOString();
  const todayWib = getWibDateString(now);
  const twentyFourHoursAgoIso = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();

  // 2. Cek status absensi aktif di database
  const filterCol = isEscort ? 'escort_id' : 'employee_id';
  const filterVal = isEscort ? escort_id : employee_id;

  const attendanceLookup = await (mode === 'masuk'
    ? adminClient
        .from('attendance')
        .select('id, employee_id, escort_id, subject_type, work_date, masuk_at, istirahat_at, istirahat_kembali_at, pulang_at')
        .eq(filterCol, filterVal)
        .eq('work_date', todayWib)
        .maybeSingle()
    : adminClient
        .from('attendance')
        .select('id, employee_id, escort_id, subject_type, work_date, masuk_at, istirahat_at, istirahat_kembali_at, pulang_at')
        .eq(filterCol, filterVal)
        .not('masuk_at', 'is', null)
        .is('pulang_at', null)
        .gte('masuk_at', twentyFourHoursAgoIso)
        .order('masuk_at', { ascending: false })
        .limit(1)
        .maybeSingle());

  // === MODE: MASUK ===
  if (mode === 'masuk') {
    const existingToday = attendanceLookup.data as {
      id: string;
      masuk_at: string | null;
      istirahat_at: string | null;
      istirahat_kembali_at: string | null;
      pulang_at: string | null;
    } | null;

    if (existingToday?.masuk_at) {
      return NextResponse.json(
        {
          duplicate: true,
          error: `Sudah absen masuk pukul ${formatWibTimeShort(existingToday.masuk_at)} WIB`,
          employeeName: subject.name,
        },
        { status: 409 }
      );
    }

    let attendanceId: string;

    if (existingToday) {
      const { data: updated, error: updErr } = await adminClient
        .from('attendance')
        .update({
          masuk_at: nowIso,
          subject_type,
        })
        .eq('id', existingToday.id)
        .select('id')
        .single();

      if (updErr || !updated) {
        return NextResponse.json(
          { error: updErr?.message ?? 'Gagal memperbarui absensi masuk.' },
          { status: 500 }
        );
      }
      attendanceId = updated.id;
    } else {
      const newAttendancePayload: Record<string, unknown> = {
        employee_id,
        escort_id,
        subject_type,
        work_date: todayWib,
        masuk_at: nowIso,
      };

      const { data: inserted, error: insErr } = await adminClient
        .from('attendance')
        .insert(newAttendancePayload)
        .select('id')
        .single();

      if (insErr) {
        if (insErr.code === '23505') {
          return NextResponse.json(
            {
              duplicate: true,
              error: 'Sudah absen masuk hari ini.',
              employeeName: subject.name,
            },
            { status: 409 }
          );
        }
        return NextResponse.json({ error: insErr.message }, { status: 500 });
      }

      if (!inserted) {
        return NextResponse.json({ error: 'Gagal membuat data absensi masuk.' }, { status: 500 });
      }
      attendanceId = inserted.id;
    }

    const { data: insertedEvent } = await adminClient
      .from('attendance_events')
      .insert({
        employee_id,
        escort_id,
        subject_type,
        attendance_id: attendanceId,
        event_type: 'masuk',
        occurred_at: nowIso,
        match_distance: verification.score,
        verification_id: verification.id,
        second_subject_id: verification.second_subject_id,
        second_distance: verification.second_score,
        margin: verification.margin,
        decision_zone: verification.zone,
        frames_used: verification.frames_used,
        before_state: existingToday ?? null,
      })
      .select('id')
      .single();

    return NextResponse.json({
      success: true,
      event_id: insertedEvent?.id,
      mode,
      employee: { id: subject.id, name: subject.name, position: subject.subtitle, subject_type },
      occurredAt: nowIso,
      formattedDate: formatWibDateFull(now),
      formattedTime: formatWibTimeSeconds(now),
    });
  }

  // === MODE: ISTIRAHAT (MULAI & KEMBALI) ===
  if (mode === 'istirahat' || mode === 'istirahat_kembali') {
    const activeShift = attendanceLookup.data as {
      id: string;
      masuk_at: string | null;
      istirahat_at: string | null;
      istirahat_kembali_at: string | null;
      pulang_at: string | null;
    } | null;

    if (!activeShift) {
      return NextResponse.json(
        {
          error: 'Belum ada absen Masuk yang aktif. Silakan absen Masuk terlebih dahulu.',
          employeeName: subject.name,
        },
        { status: 400 }
      );
    }

    // 1. Belum absen istirahat sama sekali -> Catat MULAI ISTIRAHAT
    if (!activeShift.istirahat_at) {
      const beforeState = { ...activeShift };
      const { error: updateErr } = await adminClient
        .from('attendance')
        .update({ istirahat_at: nowIso })
        .eq('id', activeShift.id);

      if (updateErr) {
        return NextResponse.json({ error: updateErr.message }, { status: 500 });
      }

      const { data: insertedEvent } = await adminClient
        .from('attendance_events')
        .insert({
          employee_id,
          escort_id,
          subject_type,
          attendance_id: activeShift.id,
          event_type: 'istirahat',
          occurred_at: nowIso,
          match_distance: verification.score,
          verification_id: verification.id,
          second_subject_id: verification.second_subject_id,
          second_distance: verification.second_score,
          margin: verification.margin,
          decision_zone: verification.zone,
          frames_used: verification.frames_used,
          before_state: beforeState,
        })
        .select('id')
        .single();

      return NextResponse.json({
        success: true,
        event_id: insertedEvent?.id,
        mode: 'istirahat',
        action: 'mulai',
        title: 'Mulai Istirahat Berhasil',
        statusMessage: 'Selamat beristirahat',
        employee: { id: subject.id, name: subject.name, position: subject.subtitle, subject_type },
        occurredAt: nowIso,
        formattedDate: formatWibDateFull(now),
        formattedTime: formatWibTimeSeconds(now),
      });
    }

    // 2. Sudah mulai istirahat tapi belum kembali -> Catat KEMBALI DARI ISTIRAHAT
    if (activeShift.istirahat_at && !activeShift.istirahat_kembali_at) {
      const startMillis = new Date(activeShift.istirahat_at).getTime();
      const diffSeconds = Math.floor((now.getTime() - startMillis) / 1000);

      // Cek proteksi double scan (kurang dari 60 detik)
      if (diffSeconds < 60) {
        return NextResponse.json(
          {
            duplicate: true,
            error: `Baru saja absen Mulai Istirahat pukul ${formatWibTimeShort(activeShift.istirahat_at)} WIB. Mohon tunggu minimal 1 menit sebelum absen kembali.`,
            employeeName: subject.name,
          },
          { status: 409 }
        );
      }

      const beforeState = { ...activeShift };
      const diffMinutes = Math.max(1, Math.round((now.getTime() - startMillis) / (60 * 1000)));
      const durationLabel = formatMinutesHuman(diffMinutes);

      const { error: updateErr } = await adminClient
        .from('attendance')
        .update({ istirahat_kembali_at: nowIso })
        .eq('id', activeShift.id);

      if (updateErr) {
        return NextResponse.json({ error: updateErr.message }, { status: 500 });
      }

      const { data: insertedEvent } = await adminClient
        .from('attendance_events')
        .insert({
          employee_id,
          escort_id,
          subject_type,
          attendance_id: activeShift.id,
          event_type: 'istirahat_kembali',
          occurred_at: nowIso,
          match_distance: verification.score,
          verification_id: verification.id,
          second_subject_id: verification.second_subject_id,
          second_distance: verification.second_score,
          margin: verification.margin,
          decision_zone: verification.zone,
          frames_used: verification.frames_used,
          before_state: beforeState,
        })
        .select('id')
        .single();

      return NextResponse.json({
        success: true,
        event_id: insertedEvent?.id,
        mode: 'istirahat',
        action: 'kembali',
        title: 'Kembali Istirahat Berhasil',
        statusMessage: 'Selamat bertugas kembali',
        breakStartFormatted: `${formatWibTimeShort(activeShift.istirahat_at)} WIB`,
        durationMinutes: diffMinutes,
        durationLabel,
        employee: { id: subject.id, name: subject.name, position: subject.subtitle, subject_type },
        occurredAt: nowIso,
        formattedDate: formatWibDateFull(now),
        formattedTime: formatWibTimeSeconds(now),
      });
    }

    // 3. Keduanya sudah terisi -> Sudah menyelesaikan istirahat shift ini
    const kembaliStr = activeShift.istirahat_kembali_at
      ? formatWibTimeShort(activeShift.istirahat_kembali_at)
      : formatWibTimeShort(nowIso);

    return NextResponse.json(
      {
        duplicate: true,
        error: `Sudah menyelesaikan istirahat shift ini (Mulai ${formatWibTimeShort(activeShift.istirahat_at)} WIB s/d ${kembaliStr} WIB).`,
        employeeName: subject.name,
      },
      { status: 409 }
    );
  }

  // === MODE: PULANG ===
  const openShift = attendanceLookup.data as {
    id: string;
    masuk_at: string | null;
    pulang_at: string | null;
  } | null;

  if (!openShift) {
    const { data: todayRow } = await adminClient
      .from('attendance')
      .select('pulang_at')
      .eq(filterCol, filterVal)
      .eq('work_date', todayWib)
      .maybeSingle();

    if (todayRow?.pulang_at) {
      return NextResponse.json(
        {
          duplicate: true,
          error: `Sudah absen pulang pukul ${formatWibTimeShort(todayRow.pulang_at)} WIB`,
          employeeName: subject.name,
        },
        { status: 409 }
      );
    }

    return NextResponse.json(
      {
        error: 'Belum ditemukan absen Masuk yang aktif (maksimal 24 jam terakhir). Silakan absen Masuk terlebih dahulu.',
        employeeName: subject.name,
      },
      { status: 400 }
    );
  }

  const beforeState = { ...openShift };
  const { error: pulangErr } = await adminClient
    .from('attendance')
    .update({ pulang_at: nowIso })
    .eq('id', openShift.id);

  if (pulangErr) {
    return NextResponse.json({ error: pulangErr.message }, { status: 500 });
  }

  const { data: insertedEvent } = await adminClient
    .from('attendance_events')
    .insert({
      employee_id,
      escort_id,
      subject_type,
      attendance_id: openShift.id,
      event_type: 'pulang',
      occurred_at: nowIso,
      match_distance: verification.score,
      verification_id: verification.id,
      second_subject_id: verification.second_subject_id,
      second_distance: verification.second_score,
      margin: verification.margin,
      decision_zone: verification.zone,
      frames_used: verification.frames_used,
      before_state: beforeState,
    })
    .select('id')
    .single();

  return NextResponse.json({
    success: true,
    event_id: insertedEvent?.id,
    mode,
    employee: { id: subject.id, name: subject.name, position: subject.subtitle, subject_type },
    occurredAt: nowIso,
    formattedDate: formatWibDateFull(now),
    formattedTime: formatWibTimeSeconds(now),
  });
}
