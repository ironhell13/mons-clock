import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { requireApiRole } from '@/lib/auth';
import { createAdminClient } from '@/lib/supabase/admin';
import { getActiveFaceConfig } from '@/lib/face-config';
import type { FaceVerification, FaceVerificationCandidate } from '@/types/database';

const confirmSchema = z.object({
  verification_id: z.string().uuid('ID verifikasi tidak valid.'),
  chosen_subject_id: z.string().uuid('ID subjek tidak valid.'),
  factor: z.string().optional().nullable(),
});

export async function POST(req: NextRequest) {
  const auth = await requireApiRole(['absen', 'admin', 'hrd', 'superadmin']);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const body = (await req.json()) as Record<string, unknown>;
  const parsed = confirmSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.errors[0]?.message ?? 'Permintaan konfirmasi tidak valid.' },
      { status: 400 }
    );
  }

  const { verification_id, chosen_subject_id, factor } = parsed.data;
  const config = getActiveFaceConfig();
  const adminClient = createAdminClient();
  const now = new Date();

  // 1. Ambil data verifikasi
  const { data: row, error } = await adminClient
    .from('face_verifications')
    .select('*')
    .eq('id', verification_id)
    .maybeSingle();

  if (error || !row) {
    return NextResponse.json(
      { error: 'Sesi verifikasi tidak ditemukan.' },
      { status: 404 }
    );
  }

  const verification = row as FaceVerification;

  // 2. Validasi status sesi
  if (verification.kiosk_user_id !== auth.session.userId) {
    return NextResponse.json(
      { error: 'Sesi verifikasi tidak sesuai dengan perangkat ini.' },
      { status: 403 }
    );
  }

  if (new Date(verification.expires_at) < now) {
    return NextResponse.json(
      { error: 'Sesi konfirmasi telah kedaluwarsa. Silakan scan wajah ulang.' },
      { status: 410 }
    );
  }

  if (verification.zone !== 'confirm') {
    return NextResponse.json(
      { error: 'Sesi ini tidak memerlukan konfirmasi tambahan.' },
      { status: 400 }
    );
  }

  if (verification.confirm_attempts >= config.MAX_CONFIRM_ATTEMPTS) {
    return NextResponse.json(
      {
        status: 'locked',
        error: 'Percobaan konfirmasi telah terkunci karena melebihi batas percobaan. Silakan scan ulang.',
      },
      { status: 423 }
    );
  }

  // 3. Pastikan chosen_subject_id ada di daftar kandidat yang ditawarkan
  const candidates = (verification.candidates ?? []) as FaceVerificationCandidate[];
  const candidateMatch = candidates.find((c) => c.id === chosen_subject_id);
  if (!candidateMatch) {
    return NextResponse.json(
      { error: 'Kandidat yang dipilih tidak terdaftar pada sesi verifikasi ini.' },
      { status: 400 }
    );
  }

  // 4. Verifikasi Identitas Kandidat (Karyawan atau Pengawal)
  const { data: emp } = await adminClient
    .from('employees')
    .select('id, name, position, employee_no, rfid_no, is_active')
    .eq('id', chosen_subject_id)
    .maybeSingle();

  if (emp && emp.is_active) {
    const cleanedFactor = (factor ?? '').trim().toLowerCase();
    const empNo = emp.employee_no.trim().toLowerCase();
    const last4 = empNo.length >= 4 ? empNo.slice(-4) : empNo;
    const rfid = (emp.rfid_no ?? '').trim().toLowerCase();

    const matchesNoId = cleanedFactor.length >= 2 && (cleanedFactor === last4 || cleanedFactor === empNo);
    const matchesRfid = rfid.length > 0 && cleanedFactor === rfid;

    if (!matchesNoId && !matchesRfid) {
      const nextAttempts = verification.confirm_attempts + 1;
      const isNowLocked = nextAttempts >= config.MAX_CONFIRM_ATTEMPTS;

      await adminClient
        .from('face_verifications')
        .update({
          confirm_attempts: nextAttempts,
          zone: isNowLocked ? 'reject' : 'confirm',
        })
        .eq('id', verification_id);

      await adminClient.from('audit_logs').insert({
        user_id: auth.session.userId,
        action: 'face_confirm_failed',
        table_name: 'face_verifications',
        record_id: verification_id,
        reason: `Percobaan konfirmasi ke-${nextAttempts} gagal untuk karyawan ${emp.name}`,
        payload: { attempts: nextAttempts, locked: isNowLocked },
      });

      return NextResponse.json({
        status: isNowLocked ? 'locked' : 'retry',
        error: isNowLocked
          ? 'Percobaan konfirmasi salah 3 kali. Sesi terkunci, silakan scan ulang.'
          : `4 karakter terakhir No ID salah. Sisa kesempatan: ${config.MAX_CONFIRM_ATTEMPTS - nextAttempts}`,
        remainingAttempts: Math.max(0, config.MAX_CONFIRM_ATTEMPTS - nextAttempts),
      });
    }

    // Berhasil verifikasi faktor kedua karyawan
    await adminClient
      .from('face_verifications')
      .update({
        subject_id: emp.id,
        subject_type: 'employee',
        confirmed_method: matchesRfid ? 'rfid' : 'no_id_last4',
      })
      .eq('id', verification_id);

    return NextResponse.json({
      status: 'accepted',
      verification_id,
      subject: {
        id: emp.id,
        name: emp.name,
        subtitle: emp.position,
        code: emp.employee_no,
        subject_type: 'employee',
      },
    });
  }

  // 5. Untuk Pengawal (Escort)
  const { data: esc, error: escErr } = await adminClient
    .from('escorts')
    .select('id, name, vendor, nig, is_active')
    .eq('id', chosen_subject_id)
    .maybeSingle();

  if (escErr || !esc || !esc.is_active) {
    return NextResponse.json(
      { error: 'Subjek tidak ditemukan atau nonaktif.' },
      { status: 404 }
    );
  }

  await adminClient
    .from('face_verifications')
    .update({
      subject_id: esc.id,
      subject_type: 'escort',
      confirmed_method: 'manual_select',
    })
    .eq('id', verification_id);

  return NextResponse.json({
    status: 'accepted',
    verification_id,
    subject: {
      id: esc.id,
      name: esc.name,
      subtitle: esc.vendor,
      code: esc.nig ?? undefined,
      subject_type: 'escort',
    },
  });
}

