import { NextResponse, type NextRequest } from 'next/server';
import { requireApiRole } from '@/lib/auth';
import { createAdminClient } from '@/lib/supabase/admin';
import { faceEnrollSchema } from '@/lib/validators';

function euclideanDist(a: number[], b: number[]): number {
  if (a.length !== b.length) return Number.POSITIVE_INFINITY;
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    const d = a[i] - b[i];
    sum += d * d;
  }
  return Math.sqrt(sum);
}

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

  // Cek kemiripan terhadap orang lain yang sudah terdaftar
  const threshold = Number(process.env.NEXT_PUBLIC_FACE_THRESHOLD || '0.5') || 0.5;
  const col = subject_type === 'employee' ? 'employee_id' : 'escort_id';

  const { data: otherTemplates } = await adminClient
    .from('face_templates')
    .select('employee_id, escort_id, descriptor')
    .eq('subject_type', subject_type)
    .neq(col, subject_id);

  if (otherTemplates && otherTemplates.length > 0) {
    for (const sample of samples) {
      for (const existing of otherTemplates) {
        const dist = euclideanDist(sample.descriptor, existing.descriptor as number[]);
        if (dist < threshold * 0.92) {
          const otherId = existing[col];
          let otherName = 'orang lain';
          if (otherId) {
            const { data: otherRow } = await adminClient
              .from(targetTable)
              .select('name')
              .eq('id', otherId)
              .single();
            if (otherRow?.name) otherName = otherRow.name;
          }
          return NextResponse.json(
            {
              error: `Wajah terlalu mirip dengan profil "${otherName}" yang sudah terdaftar. Pastikan nama yang dipilih sudah benar.`,
            },
            { status: 409 }
          );
        }
      }
    }
  }

  const insertPayload = samples.map((s) => ({
    subject_type,
    employee_id: subject_type === 'employee' ? subject_id : null,
    escort_id: subject_type === 'escort' ? subject_id : null,
    descriptor: s.descriptor,
    sample_label: s.sample_label,
  }));

  const { error: insertErr } = await adminClient.from('face_templates').insert(insertPayload);
  if (insertErr) {
    return NextResponse.json({ error: insertErr.message }, { status: 400 });
  }

  await adminClient.from('audit_logs').insert({
    user_id: auth.session.userId,
    action: 'enroll_face',
    table_name: 'face_templates',
    record_id: subject_id,
    payload: {
      subject_type,
      subject_name: subjectRow.name,
      sample_count: samples.length,
    },
  });

  return NextResponse.json({
    success: true,
    inserted: samples.length,
    name: subjectRow.name,
  });
}

