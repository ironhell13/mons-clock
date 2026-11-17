import { NextResponse, type NextRequest } from 'next/server';
import { requireApiRole } from '@/lib/auth';
import { createAdminClient } from '@/lib/supabase/admin';

export async function GET() {
  const auth = await requireApiRole(['superadmin']);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const adminClient = createAdminClient();
  const { data: flags, error } = await adminClient
    .from('face_lookalike_flags')
    .select('id, subject_type, subject_a, subject_b, created_at')
    .order('created_at', { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Ambil nama subjek a dan subjek b
  const employeeIds = new Set<string>();
  const escortIds = new Set<string>();

  for (const f of flags ?? []) {
    if (f.subject_type === 'employee') {
      employeeIds.add(f.subject_a);
      employeeIds.add(f.subject_b);
    } else {
      escortIds.add(f.subject_a);
      escortIds.add(f.subject_b);
    }
  }

  const nameMap = new Map<string, string>();

  if (employeeIds.size > 0) {
    const { data: emps } = await adminClient
      .from('employees')
      .select('id, name')
      .in('id', Array.from(employeeIds));
    for (const e of emps ?? []) nameMap.set(e.id, e.name);
  }

  if (escortIds.size > 0) {
    const { data: escs } = await adminClient
      .from('escorts')
      .select('id, name')
      .in('id', Array.from(escortIds));
    for (const e of escs ?? []) nameMap.set(e.id, e.name);
  }

  const formatted = (flags ?? []).map((f) => ({
    id: f.id,
    subject_type: f.subject_type,
    subject_a: f.subject_a,
    subject_b: f.subject_b,
    name_a: nameMap.get(f.subject_a) ?? 'Tidak Diketahui',
    name_b: nameMap.get(f.subject_b) ?? 'Tidak Diketahui',
    created_at: f.created_at,
  }));

  return NextResponse.json({ flags: formatted });
}

export async function POST(req: NextRequest) {
  const auth = await requireApiRole(['superadmin']);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const body = (await req.json()) as {
    subject_type?: 'employee' | 'escort';
    subject_a?: string;
    subject_b?: string;
  };

  const { subject_type = 'employee', subject_a, subject_b } = body;
  if (!subject_a || !subject_b || subject_a === subject_b) {
    return NextResponse.json(
      { error: 'ID subjek A dan B harus valid dan berbeda.' },
      { status: 400 }
    );
  }

  const adminClient = createAdminClient();

  // Pastikan urutan konsisten (canonical) agar tidak ada duplikat terbalik
  const [first, second] = [subject_a, subject_b].sort();

  const { data, error } = await adminClient
    .from('face_lookalike_flags')
    .upsert(
      {
        subject_type,
        subject_a: first,
        subject_b: second,
        created_by: auth.session.userId,
      },
      { onConflict: 'subject_a,subject_b' }
    )
    .select('id')
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  await adminClient.from('audit_logs').insert({
    user_id: auth.session.userId,
    action: 'flag_lookalike_pair',
    table_name: 'face_lookalike_flags',
    record_id: data.id,
    payload: { subject_type, subject_a: first, subject_b: second },
  });

  return NextResponse.json({ success: true, id: data.id });
}

export async function DELETE(req: NextRequest) {
  const auth = await requireApiRole(['superadmin']);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const { searchParams } = new URL(req.url);
  const id = searchParams.get('id');
  const subjectA = searchParams.get('subject_a');
  const subjectB = searchParams.get('subject_b');

  const adminClient = createAdminClient();

  let query = adminClient.from('face_lookalike_flags').delete();
  if (id) {
    query = query.eq('id', id);
  } else if (subjectA && subjectB) {
    const [first, second] = [subjectA, subjectB].sort();
    query = query.eq('subject_a', first).eq('subject_b', second);
  } else {
    return NextResponse.json(
      { error: 'ID atau pasangan subject_a & subject_b diperlukan.' },
      { status: 400 }
    );
  }

  const { error } = await query;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  await adminClient.from('audit_logs').insert({
    user_id: auth.session.userId,
    action: 'unflag_lookalike_pair',
    table_name: 'face_lookalike_flags',
    payload: { id, subject_a: subjectA, subject_b: subjectB },
  });

  return NextResponse.json({ success: true });
}

