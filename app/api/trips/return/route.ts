import { NextResponse, type NextRequest } from 'next/server';
import { requireApiRole } from '@/lib/auth';
import { createAdminClient } from '@/lib/supabase/admin';
import { tripReturnSchema } from '@/lib/validators';
import { verifyScanTimestampToken } from '@/lib/server-token';
import { formatDurationHHMM, formatWibDateFull, formatWibTimeSeconds } from '@/lib/time';

export async function POST(req: NextRequest) {
  const auth = await requireApiRole(['absen']);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const body = (await req.json()) as Record<string, unknown>;
  const parsed = tripReturnSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.errors[0]?.message ?? 'Data kepulangan tidak valid.' },
      { status: 400 }
    );
  }

  const { trip_id, scanned_employee_id, km_end } = parsed.data;
  const adminClient = createAdminClient();

  const { data: existing, error: findErr } = await adminClient
    .from('trips')
    .select('id, trip_type, depart_at, return_at, staff1_id, staff2_id, plate, km_start')
    .eq('id', trip_id)
    .single();

  if (findErr || !existing) {
    return NextResponse.json({ error: 'Data trip tidak ditemukan.' }, { status: 404 });
  }

  if (existing.return_at) {
    return NextResponse.json({ error: 'Trip ini sudah ditutup sebelumnya.' }, { status: 409 });
  }

  if (
    existing.staff1_id !== scanned_employee_id &&
    existing.staff2_id !== scanned_employee_id
  ) {
    return NextResponse.json(
      { error: 'Hanya Staff 1 atau Staff 2 pada trip ini yang dapat menutup perjalanan.' },
      { status: 403 }
    );
  }

  if (km_end < existing.km_start) {
    return NextResponse.json(
      { error: `KM Akhir tidak boleh lebih kecil dari KM Awal (${existing.km_start}).` },
      { status: 400 }
    );
  }

  const scanToken = typeof body.scanToken === 'string' ? body.scanToken : undefined;
  const returnAt = verifyScanTimestampToken(scanToken, scanned_employee_id, existing.trip_type);
  const departDate = new Date(existing.depart_at);
  const effectiveReturnAt = returnAt.getTime() < departDate.getTime() ? new Date() : returnAt;

  const [{ data: updated, error: updErr }, { data: empRow }] = await Promise.all([
    adminClient
      .from('trips')
      .update({
        return_at: effectiveReturnAt.toISOString(),
        km_end,
      })
      .eq('id', trip_id)
      .select('id, depart_at, return_at, plate, km_start, km_end, duration_minutes, total_km')
      .single(),
    adminClient
      .from('employees')
      .select('name')
      .eq('id', scanned_employee_id)
      .single(),
  ]);

  if (updErr || !updated) {
    return NextResponse.json({ error: updErr?.message ?? 'Gagal menyimpan data kembali.' }, { status: 500 });
  }

  return NextResponse.json({
    success: true,
    trip: updated,
    staffName: empRow?.name ?? '',
    formattedDate: formatWibDateFull(updated.return_at!),
    formattedTime: formatWibTimeSeconds(updated.return_at!),
    durationHHMM: formatDurationHHMM(updated.duration_minutes),
    totalKm: updated.total_km ?? km_end - existing.km_start,
  });
}

