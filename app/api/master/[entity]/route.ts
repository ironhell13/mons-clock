import { NextResponse, type NextRequest } from 'next/server';
import { requireApiRole } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { isValidMasterEntity, MASTER_CONFIG } from '@/lib/master-config';
import {
  areaSchema,
  cleanText,
  employeeSchema,
  escortSchema,
  positionSchema,
  vehicleSchema,
  vendorSchema,
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
    case 'jabatan':
      return positionSchema.safeParse({
        name: cleanText(String(body.name ?? '')),
        is_active: body.is_active ?? true,
      });
    case 'vendor':
      return vendorSchema.safeParse({
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
  if (
    error.code === '42P01' ||
    error.message?.includes('Could not find the table') ||
    error.message?.includes('does not exist')
  ) {
    return 'Tabel belum dibuat di Supabase. Jalankan migration 0002_master_positions_vendors.sql di Supabase SQL Editor.';
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
    return NextResponse.json({ error: mapDbError(error) }, { status: 500 });
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

  // Ambil daftar Master Jabatan untuk Karyawan, dan Master Vendor untuk Pengawal
  let masterChoices: string[] = [];
  if (entity === 'karyawan') {
    const { data: posRows, error: posErr } = await supabase
      .from('positions')
      .select('name')
      .eq('is_active', true)
      .order('name');
    if (!posErr && posRows) {
      masterChoices = posRows.map((p) => p.name);
    } else {
      masterChoices = Array.from(
        new Set(
          (data ?? [])
            .map((r: Record<string, unknown>) => String(r.position ?? '').trim())
            .filter(Boolean)
        )
      ).sort((a, b) => a.localeCompare(b));
    }
  } else if (entity === 'pengawal') {
    const { data: venRows, error: venErr } = await supabase
      .from('vendors')
      .select('name')
      .eq('is_active', true)
      .order('name');
    if (!venErr && venRows) {
      masterChoices = venRows.map((v) => v.name);
    } else {
      masterChoices = Array.from(
        new Set(
          (data ?? [])
            .map((r: Record<string, unknown>) => String(r.vendor ?? '').trim())
            .filter(Boolean)
        )
      ).sort((a, b) => a.localeCompare(b));
    }
  }

  return NextResponse.json({
    items: (data ?? []).map((item: Record<string, unknown>) => ({
      ...item,
      face_count: meta.hasFaceStatus ? faceCountMap[String(item.id)] ?? 0 : undefined,
    })),
    masterChoices,
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

  // Pastikan nilai jabatan/vendor baru ikut tercatat di master positions/vendors jika tabel sudah tersedia
  if (entity === 'karyawan' && typeof payloadData.position === 'string' && payloadData.position) {
    await supabase
      .from('positions')
      .upsert({ name: payloadData.position, is_active: true }, { onConflict: 'name' });
  } else if (entity === 'pengawal' && typeof payloadData.vendor === 'string' && payloadData.vendor) {
    await supabase
      .from('vendors')
      .upsert({ name: payloadData.vendor, is_active: true }, { onConflict: 'name' });
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

  let previousName: string | null = null;
  if (entity === 'jabatan' || entity === 'vendor') {
    const { data: oldRow } = await supabase
      .from(meta.table)
      .select('name')
      .eq('id', id)
      .single();
    previousName = oldRow?.name ?? null;
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

  // Sinkronkan perubahan nama jabatan/vendor ke tabel karyawan/pengawal
  if (
    entity === 'jabatan' &&
    previousName &&
    typeof payloadData.name === 'string' &&
    previousName !== payloadData.name
  ) {
    await supabase
      .from('employees')
      .update({ position: payloadData.name })
      .eq('position', previousName);
  } else if (
    entity === 'vendor' &&
    previousName &&
    typeof payloadData.name === 'string' &&
    previousName !== payloadData.name
  ) {
    await supabase
      .from('escorts')
      .update({ vendor: payloadData.name })
      .eq('vendor', previousName);
  } else if (entity === 'karyawan' && typeof payloadData.position === 'string' && payloadData.position) {
    await supabase
      .from('positions')
      .upsert({ name: payloadData.position, is_active: true }, { onConflict: 'name' });
  } else if (entity === 'pengawal' && typeof payloadData.vendor === 'string' && payloadData.vendor) {
    await supabase
      .from('vendors')
      .upsert({ name: payloadData.vendor, is_active: true }, { onConflict: 'name' });
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

  if (entity === 'jabatan' || entity === 'vendor') {
    const { data: row } = await supabase
      .from(meta.table)
      .select('name')
      .eq('id', id)
      .single();
    if (row?.name) {
      const targetTable = entity === 'jabatan' ? 'employees' : 'escorts';
      const targetCol = entity === 'jabatan' ? 'position' : 'vendor';
      const { count } = await supabase
        .from(targetTable)
        .select('id', { count: 'exact', head: true })
        .eq(targetCol, row.name);
      if ((count ?? 0) > 0) {
        return NextResponse.json(
          {
            error: `${meta.singular} "${row.name}" masih dipakai oleh ${count} data ${
              entity === 'jabatan' ? 'Karyawan' : 'Pengawal'
            }. Ubah datanya dulu atau gunakan Nonaktifkan.`,
          },
          { status: 409 }
        );
      }
    }
  }

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
