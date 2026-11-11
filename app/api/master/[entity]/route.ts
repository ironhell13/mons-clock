import { NextResponse, type NextRequest } from 'next/server';
import { requireApiRole } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { isValidMasterEntity, MASTER_CONFIG } from '@/lib/master-config';
import {
  areaSchema,
  cleanText,
  employeeSchema,
  escortSchema,
  vehicleSchema,
  workshopSchema,
} from '@/lib/validators';

function validatePayload(entity: string, body: Record<string, unknown>) {
  switch (entity) {
    case 'karyawan':
      return employeeSchema.safeParse({
        rfid_no: body.rfid_no ? cleanText(String(body.rfid_no)) : null,
        name: cleanText(String(body.name ?? '')),
        position: cleanText(String(body.position ?? '')),
        employee_no: cleanText(String(body.employee_no ?? '')),
        is_active: body.is_active ?? true,
      });
    case 'pengawal':
      return escortSchema.safeParse({
        name: cleanText(String(body.name ?? '')),
        vendor: cleanText(String(body.vendor ?? '')),
        is_active: body.is_active ?? true,
      });
    case 'area':
      return areaSchema.safeParse({
        name: cleanText(String(body.name ?? '')),
        is_active: body.is_active ?? true,
      });
    case 'nopol':
      return vehicleSchema.safeParse({
        plate: String(body.plate ?? ''),
        is_active: body.is_active ?? true,
      });
    case 'bengkel':
      return workshopSchema.safeParse({
        name: cleanText(String(body.name ?? '')),
        is_active: body.is_active ?? true,
      });
    default:
      return null;
  }
}

function mapDbError(error: { code?: string; message?: string }) {
  if (error.code === '23505') {
    return 'Data sudah ada (duplikat). Periksa kembali nilai uniknya.';
  }
  if (error.code === '23503') {
    return 'Data tidak dapat dihapus karena masih dipakai oleh riwayat transaksi. Gunakan Nonaktifkan.';
  }
  return error.message || 'Terjadi kesalahan pada database.';
}

export async function GET(
  _req: NextRequest,
  context: { params: Promise<{ entity: string }> }
) {
  const auth = await requireApiRole(['admin', 'superadmin']);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const { entity } = await context.params;
  if (!isValidMasterEntity(entity)) {
    return NextResponse.json({ error: 'Entitas master tidak valid.' }, { status: 400 });
  }

  const meta = MASTER_CONFIG[entity];
  const supabase = await createClient();

  const { data, error } = await supabase
    .from(meta.table)
    .select('*')
    .order(meta.defaultSortKey, { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  let faceCountMap: Record<string, number> = {};
  if (meta.hasFaceStatus) {
    const col = entity === 'karyawan' ? 'employee_id' : 'escort_id';
    const subjectType = entity === 'karyawan' ? 'employee' : 'escort';
    const { data: templates } = await supabase
      .from('face_templates')
      .select('employee_id, escort_id')
      .eq('subject_type', subjectType);

    faceCountMap = (templates ?? []).reduce<Record<string, number>>((acc, row) => {
      const key = row[col];
      if (key) acc[key] = (acc[key] ?? 0) + 1;
      return acc;
    }, {});
  }

  return NextResponse.json({
    items: (data ?? []).map((item: Record<string, unknown>) => ({
      ...item,
      face_count: meta.hasFaceStatus ? faceCountMap[String(item.id)] ?? 0 : undefined,
    })),
  });
}

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ entity: string }> }
) {
  const auth = await requireApiRole(['admin', 'superadmin']);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const { entity } = await context.params;
  if (!isValidMasterEntity(entity)) {
    return NextResponse.json({ error: 'Entitas master tidak valid.' }, { status: 400 });
  }

  const body = (await req.json()) as Record<string, unknown>;
  const parsed = validatePayload(entity, body);
  if (!parsed || !parsed.success) {
    const msg = parsed && !parsed.success ? parsed.error.errors[0]?.message : 'Input tidak valid.';
    return NextResponse.json({ error: msg }, { status: 400 });
  }

  const payloadData: Record<string, unknown> = parsed.data;
  const meta = MASTER_CONFIG[entity];
  const supabase = await createClient();

  const { data, error } = await supabase
    .from(meta.table)
    .insert(payloadData)
    .select('*')
    .single();

  if (error) {
    return NextResponse.json({ error: mapDbError(error) }, { status: 400 });
  }

  await supabase.from('audit_logs').insert({
    user_id: auth.session.userId,
    action: 'create',
    table_name: meta.table,
    record_id: data.id,
    payload: payloadData,
  });

  return NextResponse.json({ item: data }, { status: 201 });
}

export async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ entity: string }> }
) {
  const auth = await requireApiRole(['admin', 'superadmin']);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const { entity } = await context.params;
  if (!isValidMasterEntity(entity)) {
    return NextResponse.json({ error: 'Entitas master tidak valid.' }, { status: 400 });
  }

  const body = (await req.json()) as Record<string, unknown>;
  const id = typeof body.id === 'string' ? body.id : '';
  if (!id) {
    return NextResponse.json({ error: 'ID data wajib disertakan.' }, { status: 400 });
  }

  const meta = MASTER_CONFIG[entity];
  const supabase = await createClient();

  // Toggle status-only update
  if (Object.keys(body).length === 2 && typeof body.is_active === 'boolean') {
    const { data, error } = await supabase
      .from(meta.table)
      .update({ is_active: body.is_active })
      .eq('id', id)
      .select('*')
      .single();

    if (error) {
      return NextResponse.json({ error: mapDbError(error) }, { status: 400 });
    }

    await supabase.from('audit_logs').insert({
      user_id: auth.session.userId,
      action: body.is_active ? 'activate' : 'deactivate',
      table_name: meta.table,
      record_id: id,
      payload: { is_active: body.is_active },
    });

    return NextResponse.json({ item: data });
  }

  const parsed = validatePayload(entity, body);
  if (!parsed || !parsed.success) {
    const msg = parsed && !parsed.success ? parsed.error.errors[0]?.message : 'Input tidak valid.';
    return NextResponse.json({ error: msg }, { status: 400 });
  }

  const payloadData: Record<string, unknown> = parsed.data;
  const { data, error } = await supabase
    .from(meta.table)
    .update(payloadData)
    .eq('id', id)
    .select('*')
    .single();

  if (error) {
    return NextResponse.json({ error: mapDbError(error) }, { status: 400 });
  }

  await supabase.from('audit_logs').insert({
    user_id: auth.session.userId,
    action: 'update',
    table_name: meta.table,
    record_id: id,
    payload: payloadData,
  });

  return NextResponse.json({ item: data });
}

export async function DELETE(
  req: NextRequest,
  context: { params: Promise<{ entity: string }> }
) {
  const auth = await requireApiRole(['admin', 'superadmin']);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const { entity } = await context.params;
  if (!isValidMasterEntity(entity)) {
    return NextResponse.json({ error: 'Entitas master tidak valid.' }, { status: 400 });
  }

  const id = req.nextUrl.searchParams.get('id');
  if (!id) {
    return NextResponse.json({ error: 'ID data wajib disertakan.' }, { status: 400 });
  }

  const meta = MASTER_CONFIG[entity];
  const supabase = await createClient();

  const { error } = await supabase.from(meta.table).delete().eq('id', id);
  if (error) {
    return NextResponse.json({ error: mapDbError(error) }, { status: 400 });
  }

  await supabase.from('audit_logs').insert({
    user_id: auth.session.userId,
    action: 'delete',
    table_name: meta.table,
    record_id: id,
    payload: {},
  });

  return NextResponse.json({ success: true });
}
