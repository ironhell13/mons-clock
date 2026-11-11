import { NextResponse, type NextRequest } from 'next/server';
import { requireApiRole } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import type { SubjectType } from '@/types/database';

export async function GET(req: NextRequest) {
  const auth = await requireApiRole(['absen', 'admin', 'superadmin']);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const subjectTypeParam = req.nextUrl.searchParams.get('subject_type');
  const includeInactive = req.nextUrl.searchParams.get('include_inactive') === 'true';

  const supabase = await createClient();

  const wantEmployee = !subjectTypeParam || subjectTypeParam === 'employee' || subjectTypeParam === 'all';
  const wantEscort = !subjectTypeParam || subjectTypeParam === 'escort' || subjectTypeParam === 'all';

  const [empRes, escRes, tplRes] = await Promise.all([
    wantEmployee
      ? (includeInactive
          ? supabase.from('employees').select('id, name, position, employee_no, is_active').order('name')
          : supabase.from('employees').select('id, name, position, employee_no, is_active').eq('is_active', true).order('name'))
      : Promise.resolve({ data: [] as { id: string; name: string; position: string; employee_no: string; is_active: boolean }[] }),
    wantEscort
      ? (includeInactive
          ? supabase.from('escorts').select('id, name, vendor, is_active').order('name')
          : supabase.from('escorts').select('id, name, vendor, is_active').eq('is_active', true).order('name'))
      : Promise.resolve({ data: [] as { id: string; name: string; vendor: string; is_active: boolean }[] }),
    (() => {
      let q = supabase
        .from('face_templates')
        .select('id, subject_type, employee_id, escort_id, descriptor, sample_label, created_at');
      if (subjectTypeParam === 'employee' || subjectTypeParam === 'escort') {
        q = q.eq('subject_type', subjectTypeParam);
      }
      return q;
    })(),
  ]);

  const employees = empRes.data ?? [];
  const escorts = escRes.data ?? [];
  const rawTemplates = tplRes.data ?? [];

  const empMap = new Map(employees.map((e) => [e.id, e]));
  const escMap = new Map(escorts.map((e) => [e.id, e]));

  const countBySubject = new Map<string, number>();
  const templates: {
    id: string;
    subject_type: SubjectType;
    subject_id: string;
    name: string;
    subtitle: string;
    descriptor: number[];
    sample_label: string;
  }[] = [];

  for (const row of rawTemplates) {
    if (row.subject_type === 'employee' && row.employee_id) {
      const emp = empMap.get(row.employee_id);
      if (!emp) continue;
      countBySubject.set(`employee:${emp.id}`, (countBySubject.get(`employee:${emp.id}`) ?? 0) + 1);
      templates.push({
        id: row.id,
        subject_type: 'employee',
        subject_id: emp.id,
        name: emp.name,
        subtitle: emp.position,
        descriptor: row.descriptor,
        sample_label: row.sample_label,
      });
    } else if (row.subject_type === 'escort' && row.escort_id) {
      const esc = escMap.get(row.escort_id);
      if (!esc) continue;
      countBySubject.set(`escort:${esc.id}`, (countBySubject.get(`escort:${esc.id}`) ?? 0) + 1);
      templates.push({
        id: row.id,
        subject_type: 'escort',
        subject_id: esc.id,
        name: esc.name,
        subtitle: esc.vendor,
        descriptor: row.descriptor,
        sample_label: row.sample_label,
      });
    }
  }

  const subjects = [
    ...employees.map((e) => ({
      id: e.id,
      subject_type: 'employee' as const,
      name: e.name,
      subtitle: e.position,
      code: e.employee_no,
      is_active: e.is_active,
      sample_count: countBySubject.get(`employee:${e.id}`) ?? 0,
    })),
    ...escorts.map((e) => ({
      id: e.id,
      subject_type: 'escort' as const,
      name: e.name,
      subtitle: e.vendor,
      code: e.vendor,
      is_active: e.is_active,
      sample_count: countBySubject.get(`escort:${e.id}`) ?? 0,
    })),
  ];

  return NextResponse.json({ templates, subjects });
}

export async function DELETE(req: NextRequest) {
  const auth = await requireApiRole(['admin', 'superadmin']);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const subjectType = req.nextUrl.searchParams.get('subject_type');
  const subjectId = req.nextUrl.searchParams.get('subject_id');

  if ((subjectType !== 'employee' && subjectType !== 'escort') || !subjectId) {
    return NextResponse.json({ error: 'Parameter subjek tidak valid.' }, { status: 400 });
  }

  const adminClient = createAdminClient();
  const col = subjectType === 'employee' ? 'employee_id' : 'escort_id';

  const { error } = await adminClient
    .from('face_templates')
    .delete()
    .eq('subject_type', subjectType)
    .eq(col, subjectId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  await adminClient.from('audit_logs').insert({
    user_id: auth.session.userId,
    action: 'delete_face_templates',
    table_name: 'face_templates',
    record_id: subjectId,
    payload: { subject_type: subjectType, subject_id: subjectId },
  });

  return NextResponse.json({ success: true });
}

