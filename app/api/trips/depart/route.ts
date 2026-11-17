import { NextResponse, type NextRequest } from 'next/server';
import { requireApiRole } from '@/lib/auth';
import { createAdminClient } from '@/lib/supabase/admin';
import { tripDepartSchema } from '@/lib/validators';
import { consumeVerification } from '@/lib/face-verify';
import { verifyScanTimestampToken } from '@/lib/server-token';
import { formatWibDateFull, formatWibTimeSeconds } from '@/lib/time';

export async function POST(req: NextRequest) {
  const auth = await requireApiRole(['absen']);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const body = (await req.json()) as Record<string, unknown>;
  const parsed = tripDepartSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.errors[0]?.message ?? 'Data keberangkatan tidak valid.' },
      { status: 400 }
    );
  }

  const { trip_type, plate, km_start, area_id, run_code } = parsed.data;
  let { staff1_id, staff2_id, escort_id } = parsed.data;

  const adminClient = createAdminClient();

  if (parsed.data.staff1_verification_id) {
    const v1 = await consumeVerification(adminClient, {
      verificationId: parsed.data.staff1_verification_id,
      kioskUserId: auth.session.userId,
      purpose: 'trip_staff1',
      consume: true,
    });
    if (!v1.ok) {
      return NextResponse.json({ error: `Staff 1: ${v1.error}` }, { status: v1.status });
    }
    staff1_id = v1.subject.id;
  }

  if (parsed.data.staff2_verification_id) {
    const v2 = await consumeVerification(adminClient, {
      verificationId: parsed.data.staff2_verification_id,
      kioskUserId: auth.session.userId,
      purpose: 'trip_staff2',
      consume: true,
    });
    if (!v2.ok) {
      return NextResponse.json({ error: `Staff 2: ${v2.error}` }, { status: v2.status });
    }
    staff2_id = v2.subject.id;
  }

  if (parsed.data.escort_verification_id) {
    const ve = await consumeVerification(adminClient, {
      verificationId: parsed.data.escort_verification_id,
      kioskUserId: auth.session.userId,
      purpose: 'trip_escort',
      consume: true,
    });
    if (!ve.ok) {
      return NextResponse.json({ error: `Pengawal: ${ve.error}` }, { status: ve.status });
    }
    escort_id = ve.subject.id;
  }

  if (!staff1_id) {
    return NextResponse.json({ error: 'Staff 1 wajib diverifikasi.' }, { status: 400 });
  }

  const scanToken = typeof body.scanToken === 'string' ? body.scanToken : undefined;
  const departAt = verifyScanTimestampToken(scanToken, staff1_id, trip_type);

  // Jalankan seluruh pengecekan konflik dan referensi secara paralel
  const staffIds = staff2_id ? [staff1_id, staff2_id] : [staff1_id];
  const [openPlateRes, openStaffRes, areaRes, staff1Res] = await Promise.all([
    adminClient
      .from('trips')
      .select('id, trip_type, plate')
      .eq('plate', plate)
      .is('return_at', null)
      .limit(1)
      .maybeSingle(),
    adminClient
      .from('trips')
      .select('id, plate, staff1_id, staff2_id')
      .eq('trip_type', trip_type)
      .is('return_at', null)
      .or(staffIds.map((id) => `staff1_id.eq.${id},staff2_id.eq.${id}`).join(','))
      .limit(1)
      .maybeSingle(),
    trip_type === 'FLM'
      ? adminClient.from('areas').select('id, is_active').eq('id', area_id!).maybeSingle()
      : Promise.resolve({ data: null }),
    adminClient.from('employees').select('name, position').eq('id', staff1_id).single(),
  ]);

  if (openPlateRes.data) {
    return NextResponse.json(
      {
        error: `Kendaraan ${plate} masih tercatat dalam perjalanan ${openPlateRes.data.trip_type} yang belum kembali.`,
      },
      { status: 409 }
    );
  }

  if (openStaffRes.data) {
    return NextResponse.json(
      {
        error: `Salah satu staff masih memiliki trip ${trip_type} aktif (${openStaffRes.data.plate}) yang belum kembali.`,
      },
      { status: 409 }
    );
  }

  if (trip_type === 'FLM') {
    const areaRow = areaRes.data as { id: string; is_active: boolean } | null;
    if (!areaRow || !areaRow.is_active) {
      return NextResponse.json(
        { error: 'Area FLM harus dipilih dari data master yang aktif.' },
        { status: 400 }
      );
    }
  }

  const staff1Row = staff1Res.data;

  const { data: inserted, error: insertErr } = await adminClient
    .from('trips')
    .insert({
      trip_type,
      depart_at: departAt.toISOString(),
      staff1_id,
      staff2_id: staff2_id ?? null,
      escort_id: escort_id ?? null,
      plate,
      km_start,
      area_id: trip_type === 'FLM' ? area_id : null,
      run_code: trip_type !== 'FLM' ? run_code!.trim() : null,
    })
    .select('id, depart_at, plate')
    .single();

  if (insertErr) {
    return NextResponse.json({ error: insertErr.message }, { status: 400 });
  }

  return NextResponse.json(
    {
      success: true,
      trip: inserted,
      staff1Name: staff1Row?.name ?? '',
      formattedDate: formatWibDateFull(inserted.depart_at),
      formattedTime: formatWibTimeSeconds(inserted.depart_at),
    },
    { status: 201 }
  );
}

