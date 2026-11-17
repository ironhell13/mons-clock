import { NextResponse, type NextRequest } from 'next/server';
import { requireApiRole } from '@/lib/auth';
import { createAdminClient } from '@/lib/supabase/admin';
import { faceEnrollSchema } from '@/lib/validators';
import { getActiveFaceConfig } from '@/lib/face-config';
import { matchFacesServer } from '@/lib/face-verify';
import { isLookalikePair, type LookalikePair } from '@/lib/face-decision';

export async function POST(req: NextRequest) {
  const auth = await requireApiRole(['absen', 'admin', 'superadmin']);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const body = (await req.json()) as Record<string, unknown>;
  const parsed = faceEnrollSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.errors[0]?.message ?? 'Data sampel wajah tidak valid.' },
      { status: 400 }
    );
  }

  const { subject_type, subject_id, pin, samples } = parsed.data;
  const config = getActiveFaceConfig();

  // Di perangkat tablet (role absen), wajib verifikasi PIN admin
  if (auth.session.profile.role === 'absen') {
    const expectedPin = process.env.FACE_ENROLL_PIN?.trim();
    if (!expectedPin) {
      return NextResponse.json(
        { error: 'FACE_ENROLL_PIN belum dikonfigurasi pada server.' },
        { status: 500 }
      );
    }
    if (!pin || pin.trim() !== expectedPin) {
      return NextResponse.json(
        { error: 'PIN admin salah. Pendaftaran wajah dibatalkan.' },
        { status: 403 }
      );
    }
  }

  const adminClient = createAdminClient();
  const targetTable = subject_type === 'employee' ? 'employees' : 'escorts';
  const { data: subjectRow, error: subjectErr } = await adminClient
    .from(targetTable)
    .select('id, name, is_active')
    .eq('id', subject_id)
    .single();

  if (subjectErr || !subjectRow || !subjectRow.is_active) {
    return NextResponse.json(
      { error: 'Subjek tidak ditemukan atau tidak aktif.' },
      { status: 404 }
    );
  }

  // Ambil daftar pasangan wajah mirip (lookalike flags) yang sudah disetujui admin
  const { data: flaggedRows } = await adminClient
    .from('face_lookalike_flags')
    .select('subject_a, subject_b')
    .eq('subject_type', subject_type);

  const flaggedPairs: LookalikePair[] = (flaggedRows ?? []).map((r) => ({
    subject_a: r.subject_a,
    subject_b: r.subject_b,
  }));

  // === Penjaga Kemiripan Silang (Cross-Person Similarity Guard) ===
  // Periksa setiap sampel terhadap template orang LAIN pada subject_type yang sama
  for (const sample of samples) {
    const matches = await matchFacesServer(adminClient, sample.descriptor, subject_type);
    const otherMatches = matches.filter((m) => m.subject_id !== subject_id);

    if (otherMatches.length > 0) {
      const closest = otherMatches[0];
      // Jika skor d_top2 lebih kecil dari ENROLL_LOOKALIKE_GUARD (0.50)
      if (closest.d_top2 < config.ENROLL_LOOKALIKE_GUARD) {
        const isFlagged = isLookalikePair(subject_id, closest.subject_id, flaggedPairs);

        // Jika belum ditandai sebagai pasangan wajah mirip oleh admin, tolak pendaftaran
        if (!isFlagged) {
          let otherName = 'orang lain';
          const { data: otherRow } = await adminClient
            .from(targetTable)
            .select('name')
            .eq('id', closest.subject_id)
            .single();

          if (otherRow?.name) {
            otherName = otherRow.name;
          }

          return NextResponse.json(
            {
              error: `Wajah terdeteksi sangat mirip dengan "${otherName}" (skor kemiripan: ${closest.d_top2.toFixed(3)}). Untuk mencegah salah absen, pastikan pencahayaan merata dan wajah tidak miring/tertutup. Jika memang bersaudara/mirip, admin dapat menandainya di Halaman Audit Kemiripan.`,
              similar_subject: {
                id: closest.subject_id,
                name: otherName,
                score: closest.d_top2,
              },
            },
            { status: 409 }
          );
        }
      }
    }
  }

  // === Batasi MAX_SAMPLES_PER_SUBJECT ===
  // Cek jumlah sampel yang sudah ada untuk subjek ini
  const foreignKey = subject_type === 'employee' ? 'employee_id' : 'escort_id';
  const { data: existingTemplates } = await adminClient
    .from('face_templates')
    .select('id, created_at')
    .eq('subject_type', subject_type)
    .eq(foreignKey, subject_id)
    .order('created_at', { ascending: true });

  const currentCount = existingTemplates?.length ?? 0;
  const newCount = samples.length;
  const totalAfterInsert = currentCount + newCount;

  if (totalAfterInsert > config.MAX_SAMPLES_PER_SUBJECT && existingTemplates) {
    const pruneCount = totalAfterInsert - config.MAX_SAMPLES_PER_SUBJECT;
    const toDeleteIds = existingTemplates.slice(0, pruneCount).map((t) => t.id);

    if (toDeleteIds.length > 0) {
      await adminClient.from('face_templates').delete().in('id', toDeleteIds);
    }
  }

  // === Simpan Template Baru (Pipeline Version 2) ===
  const insertPayload = samples.map((s) => ({
    subject_type,
    employee_id: subject_type === 'employee' ? subject_id : null,
    escort_id: subject_type === 'escort' ? subject_id : null,
    descriptor: s.descriptor,
    embedding: `[${s.descriptor.join(',')}]`,
    sample_label: s.sample_label,
    pipeline_version: 2,
    quality: s.quality ?? null,
  }));

  const { error: insertErr } = await adminClient.from('face_templates').insert(insertPayload);
  if (insertErr) {
    return NextResponse.json({ error: insertErr.message }, { status: 400 });
  }

  // Catat ke audit_logs
  await adminClient.from('audit_logs').insert({
    user_id: auth.session.userId,
    action: 'enroll_face_v2',
    table_name: 'face_templates',
    record_id: subject_id,
    payload: {
      subject_type,
      subject_name: subjectRow.name,
      sample_count: samples.length,
      pipeline_version: 2,
    },
  });

  return NextResponse.json({
    success: true,
    inserted: samples.length,
    name: subjectRow.name,
  });
}
