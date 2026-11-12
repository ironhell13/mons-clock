import { NextResponse, type NextRequest } from 'next/server';
import { requireApiRole } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { isValidMasterEntity, MASTER_CONFIG } from '@/lib/master-config';
import { cleanText, normalizePlate } from '@/lib/validators';

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

  const body = (await req.json()) as { rows?: Record<string, string>[] };
  const rawRows = Array.isArray(body.rows) ? body.rows : [];
  if (rawRows.length === 0) {
    return NextResponse.json({ error: 'Tidak ada baris data untuk diimport.' }, { status: 400 });
  }

  const meta = MASTER_CONFIG[entity];
  const supabase = await createClient();

  let upsertRows: Record<string, unknown>[] = [];
  let onConflict = '';

  if (entity === 'karyawan') {
    const map = new Map<string, Record<string, unknown>>();
    for (const r of rawRows) {
      const employee_no = cleanText(r.employee_no ?? '');
      const name = cleanText(r.name ?? '');
      const position = cleanText(r.position ?? '') || '-';
      const rfid_no = cleanText(r.rfid_no ?? '') || null;
      if (!employee_no || !name) continue;
      map.set(employee_no, { employee_no, name, position, rfid_no, is_active: true });
    }
    upsertRows = Array.from(map.values());
    onConflict = 'employee_no';
  } else if (entity === 'pengawal') {
    const map = new Map<string, Record<string, unknown>>();
    for (const r of rawRows) {
      const name = cleanText(r.name ?? '');
      const vendor = cleanText(r.vendor ?? '');
      if (!name || !vendor) continue;
      const key = `${name.toLowerCase()}|||${vendor.toLowerCase()}`;
      if (!map.has(key)) {
        map.set(key, { name, vendor, is_active: true });
      }
    }
    upsertRows = Array.from(map.values());
    onConflict = 'name,vendor';
  } else if (entity === 'area') {
    const map = new Map<string, Record<string, unknown>>();
    for (const r of rawRows) {
      const name = cleanText(r.name ?? '');
      if (!name) continue;
      if (!map.has(name.toLowerCase())) {
        map.set(name.toLowerCase(), { name, is_active: true });
      }
    }
    upsertRows = Array.from(map.values());
    onConflict = 'name';
  } else if (entity === 'nopol') {
    const map = new Map<string, Record<string, unknown>>();
    for (const r of rawRows) {
      const plate = normalizePlate(r.plate ?? '');
      if (!plate) continue;
      map.set(plate, { plate, is_active: true });
    }
    upsertRows = Array.from(map.values());
    onConflict = 'plate';
  } else if (entity === 'bengkel' || entity === 'jabatan' || entity === 'vendor') {
    const map = new Map<string, Record<string, unknown>>();
    for (const r of rawRows) {
      const name = cleanText(r.name ?? '');
      if (!name) continue;
      if (!map.has(name.toLowerCase())) {
        map.set(name.toLowerCase(), { name, is_active: true });
      }
    }
    upsertRows = Array.from(map.values());
    onConflict = 'name';
  }

  if (upsertRows.length === 0) {
    return NextResponse.json({ error: 'Semua baris kosong atau tidak valid.' }, { status: 400 });
  }

  const { error } = await supabase
    .from(meta.table)
    .upsert(upsertRows, { onConflict });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  await supabase.from('audit_logs').insert({
    user_id: auth.session.userId,
    action: 'bulk_import',
    table_name: meta.table,
    payload: { imported_count: upsertRows.length },
  });

  return NextResponse.json({ count: upsertRows.length });
}

