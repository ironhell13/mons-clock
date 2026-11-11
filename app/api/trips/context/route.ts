import { NextResponse, type NextRequest } from 'next/server';
import { requireApiRole } from '@/lib/auth';
import { createAdminClient } from '@/lib/supabase/admin';
import { signScanTimestampToken } from '@/lib/server-token';
import { formatWibDateFull, formatWibTimeSeconds, formatDurationHHMM } from '@/lib/time';

export async function GET(req: NextRequest) {
  const auth = await requireApiRole(['absen']);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const tripType = req.nextUrl.searchParams.get('trip_type')?.toUpperCase();
  const employeeId = req.nextUrl.searchParams.get('employee_id');

  if ((tripType !== 'FLM' && tripType !== 'RPL' && tripType !== 'CIT') || !employeeId) {
    return NextResponse.json({ error: 'Parameter trip tidak valid.' }, { status: 400 });
  }

  const adminClient = createAdminClient();
  const now = new Date();

  const [empRes, tripsRes, vehiclesRes, areasRes] = await Promise.all([
    adminClient
      .from('employees')
      .select('id, name, position, is_active')
      .eq('id', employeeId)
      .single(),
    adminClient
      .from('trips')
      .select(`
        id,
        trip_type,
        depart_at,
        plate,
        km_start,
        run_code,
        staff1:employees!trips_staff1_id_fkey(id, name, position),
        staff2:employees!trips_staff2_id_fkey(id, name, position),
        escort:escorts(id, name, vendor),
        area:areas(id, name)
      `)
      .eq('trip_type', tripType)
      .is('return_at', null)
      .or(`staff1_id.eq.${employeeId},staff2_id.eq.${employeeId}`)
      .order('depart_at', { ascending: false }),
    adminClient.from('vehicles').select('plate').eq('is_active', true).order('plate'),
    tripType === 'FLM'
      ? adminClient.from('areas').select('id, name').eq('is_active', true).order('name')
      : Promise.resolve({ data: [] as { id: string; name: string }[] }),
  ]);

  if (empRes.error || !empRes.data || !empRes.data.is_active) {
    return NextResponse.json(
      { error: 'Karyawan tidak ditemukan atau tidak aktif.' },
      { status: 404 }
    );
  }

  const scanToken = signScanTimestampToken(employeeId, tripType, now);

  const openTrips = (tripsRes.data ?? []).map((t) => {
    const departMs = new Date(t.depart_at).getTime();
    const diffMins = Math.max(0, Math.floor((now.getTime() - departMs) / 60000));
    return {
      ...t,
      departFormattedDate: formatWibDateFull(t.depart_at),
      departFormattedTime: formatWibTimeSeconds(t.depart_at),
      estimatedDurationHHMM: formatDurationHHMM(diffMins),
    };
  });

  return NextResponse.json({
    employee: empRes.data,
    serverNowIso: now.toISOString(),
    serverFormattedDate: formatWibDateFull(now),
    serverFormattedTime: formatWibTimeSeconds(now),
    scanToken,
    openTrips,
    plates: (vehiclesRes.data ?? []).map((v) => v.plate),
    areas: areasRes.data ?? [],
  });
}

