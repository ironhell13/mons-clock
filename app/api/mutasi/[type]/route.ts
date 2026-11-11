import { NextResponse, type NextRequest } from 'next/server';
import { requireApiRole } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { goodsLogSchema, guestLogSchema, workshopLogSchema } from '@/lib/validators';

type MutasiType = 'tamu' | 'bengkel' | 'barang';

const TABLE_MAP: Record<MutasiType, { table: string; dateCol: string }> = {
  tamu: { table: 'guest_logs', dateCol: 'log_date' },
  bengkel: { table: 'workshop_logs', dateCol: 'out_date' },
  barang: { table: 'goods_logs', dateCol: 'log_date' },
};

function isMutasiType(value: string): value is MutasiType {
  return value === 'tamu' || value === 'bengkel' || value === 'barang';
}

function normalizePayload(type: MutasiType, body: Record<string, unknown>) {
  if (type === 'tamu') {
    const parsed = guestLogSchema.safeParse(body);
    if (!parsed.success) return { ok: false as const, error: parsed.error.errors[0]?.message ?? 'Input tidak valid.' };
    return {
      ok: true as const,
      data: {
        ...parsed.data,
        time_out: parsed.data.time_out ? parsed.data.time_out : null,
        notes: parsed.data.notes || null,
      },
    };
  }
  if (type === 'bengkel') {
    const parsed = workshopLogSchema.safeParse(body);
    if (!parsed.success) return { ok: false as const, error: parsed.error.errors[0]?.message ?? 'Input tidak valid.' };
    return {
      ok: true as const,
      data: {
        ...parsed.data,
        finish_date: parsed.data.finish_date ? parsed.data.finish_date : null,
        km_back: parsed.data.km_back ?? null,
        notes: parsed.data.notes || null,
      },
    };
  }
  const parsed = goodsLogSchema.safeParse(body);
  if (!parsed.success) return { ok: false as const, error: parsed.error.errors[0]?.message ?? 'Input tidak valid.' };
  return {
    ok: true as const,
    data: {
      ...parsed.data,
      time_in: parsed.data.time_in ? parsed.data.time_in : null,
      time_out: parsed.data.time_out ? parsed.data.time_out : null,
      notes: parsed.data.notes || null,
    },
  };
}

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ type: string }> }
) {
  const auth = await requireApiRole(['admin', 'superadmin']);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const { type } = await context.params;
  if (!isMutasiType(type)) {
    return NextResponse.json({ error: 'Jenis mutasi tidak valid.' }, { status: 400 });
  }

  const meta = TABLE_MAP[type];
  const supabase = await createClient();
  const fromDate = req.nextUrl.searchParams.get('from');
  const toDate = req.nextUrl.searchParams.get('to');

  let query = supabase
    .from(meta.table)
    .select('*')
    .order(meta.dateCol, { ascending: false })
    .order('created_at', { ascending: false });

  if (fromDate) query = query.gte(meta.dateCol, fromDate);
  if (toDate) query = query.lte(meta.dateCol, toDate);

  const [rowsRes, platesRes, workshopsRes] = await Promise.all([
    query,
    supabase.from('vehicles').select('plate').eq('is_active', true).order('plate'),
    type === 'bengkel'
      ? supabase.from('workshops').select('name').eq('is_active', true).order('name')
      : Promise.resolve({ data: [] as { name: string }[] }),
  ]);

  if (rowsRes.error) {
    return NextResponse.json({ error: rowsRes.error.message }, { status: 500 });
  }

  return NextResponse.json({
    items: rowsRes.data ?? [],
    plates: (platesRes.data ?? []).map((p) => p.plate),
    workshops: (workshopsRes.data ?? []).map((w) => w.name),
  });
}

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ type: string }> }
) {
  const auth = await requireApiRole(['admin', 'superadmin']);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const { type } = await context.params;
  if (!isMutasiType(type)) {
    return NextResponse.json({ error: 'Jenis mutasi tidak valid.' }, { status: 400 });
  }

  const body = (await req.json()) as Record<string, unknown>;
  const normalized = normalizePayload(type, body);
  if (!normalized.ok) {
    return NextResponse.json({ error: normalized.error }, { status: 400 });
  }

  const meta = TABLE_MAP[type];
  const supabase = await createClient();
  const insertData: Record<string, unknown> = {
    ...normalized.data,
    created_by: auth.session.userId,
  };

  const { data, error } = await supabase
    .from(meta.table)
    .insert(insertData)
    .select('*')
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  await supabase.from('audit_logs').insert({
    user_id: auth.session.userId,
    action: 'create',
    table_name: meta.table,
    record_id: data.id,
    payload: insertData,
  });

  return NextResponse.json({ item: data }, { status: 201 });
}

export async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ type: string }> }
) {
  const auth = await requireApiRole(['admin', 'superadmin']);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const { type } = await context.params;
  if (!isMutasiType(type)) {
    return NextResponse.json({ error: 'Jenis mutasi tidak valid.' }, { status: 400 });
  }

  const body = (await req.json()) as Record<string, unknown>;
  const id = typeof body.id === 'string' ? body.id : '';
  if (!id) {
    return NextResponse.json({ error: 'ID data wajib disertakan.' }, { status: 400 });
  }

  const normalized = normalizePayload(type, body);
  if (!normalized.ok) {
    return NextResponse.json({ error: normalized.error }, { status: 400 });
  }

  const meta = TABLE_MAP[type];
  const supabase = await createClient();
  const updateData: Record<string, unknown> = normalized.data;

  const { data, error } = await supabase
    .from(meta.table)
    .update(updateData)
    .eq('id', id)
    .select('*')
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  await supabase.from('audit_logs').insert({
    user_id: auth.session.userId,
    action: 'update',
    table_name: meta.table,
    record_id: id,
    payload: updateData,
  });

  return NextResponse.json({ item: data });
}

export async function DELETE(
  req: NextRequest,
  context: { params: Promise<{ type: string }> }
) {
  const auth = await requireApiRole(['admin', 'superadmin']);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const { type } = await context.params;
  if (!isMutasiType(type)) {
    return NextResponse.json({ error: 'Jenis mutasi tidak valid.' }, { status: 400 });
  }

  const id = req.nextUrl.searchParams.get('id');
  if (!id) {
    return NextResponse.json({ error: 'ID data wajib disertakan.' }, { status: 400 });
  }

  const meta = TABLE_MAP[type];
  const supabase = await createClient();
  const { error } = await supabase.from(meta.table).delete().eq('id', id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
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

