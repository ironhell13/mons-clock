import { NextResponse, type NextRequest } from 'next/server';
import { requireApiRole } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { fromWibDatetimeLocal, getWibDateString } from '@/lib/time';
import { normalizePlate } from '@/lib/validators';

export async function GET(req: NextRequest) {
  const auth = await requireApiRole(['admin', 'superadmin']);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const kind = req.nextUrl.searchParams.get('kind')?.toLowerCase();
  const from = req.nextUrl.searchParams.get('from');
  const to = req.nextUrl.searchParams.get('to');
  const employeeId = req.nextUrl.searchParams.get('employee_id');
  const plate = req.nextUrl.searchParams.get('plate');

  const supabase = await createClient();
  const adminClient = createAdminClient();

  if (kind === 'karyawan') {
    let query = supabase
      .from('attendance')
      .select(`
        id,
        employee_id,
        work_date,
        masuk_at,
        istirahat_at,
        pulang_at,
        created_at,
        employee:employees(id, name, position, employee_no)
      `)
      .order('work_date', { ascending: false })
      .order('masuk_at', { ascending: false });

    if (from) query = query.gte('work_date', from);
    if (to) query = query.lte('work_date', to);
    if (employeeId) query = query.eq('employee_id', employeeId);

    const [attRes, empRes, auditRes] = await Promise.all([
      query,
      supabase.from('employees').select('id, name, position, employee_no').order('name'),
      supabase
        .from('audit_logs')
        .select('id, user_id, action, table_name, record_id, reason, payload, created_at')
        .eq('table_name', 'attendance')
        .eq('action', 'admin_correction')
        .order('created_at', { ascending: false })
        .limit(30),
    ]);

    if (attRes.error) {
      return NextResponse.json({ error: attRes.error.message }, { status: 500 });
    }

    const userIds = Array.from(
      new Set((auditRes.data ?? []).map((a) => a.user_id).filter((x): x is string => Boolean(x)))
    );
    const profileMap = new Map<string, string>();
    if (userIds.length > 0) {
      const { data: profiles } = await adminClient
        .from('profiles')
        .select('id, full_name')
        .in('id', userIds);
      for (const p of profiles ?? []) profileMap.set(p.id, p.full_name);
    }

    return NextResponse.json({
      items: attRes.data ?? [],
      employees: empRes.data ?? [],
      auditLogs: (auditRes.data ?? []).map((log) => ({
        ...log,
        actor_name: log.user_id ? profileMap.get(log.user_id) ?? 'Admin' : 'Sistem',
      })),
    });
  }

  if (kind === 'flm' || kind === 'rpl' || kind === 'cit') {
    const tripType = kind.toUpperCase();
    let query = supabase
      .from('trips')
      .select(`
        id,
        trip_type,
        depart_at,
        return_at,
        staff1_id,
        staff2_id,
        escort_id,
        plate,
        km_start,
        km_end,
        area_id,
        run_code,
        duration_minutes,
        total_km,
        staff1:employees!trips_staff1_id_fkey(id, name, position),
        staff2:employees!trips_staff2_id_fkey(id, name, position),
        escort:escorts(id, name, vendor),
        area:areas(id, name)
      `)
      .eq('trip_type', tripType)
      .order('depart_at', { ascending: false });

    if (from) {
      query = query.gte('depart_at', `${from}T00:00:00+07:00`);
    }
    if (to) {
      query = query.lte('depart_at', `${to}T23:59:59+07:00`);
    }
    if (employeeId) {
      query = query.or(`staff1_id.eq.${employeeId},staff2_id.eq.${employeeId}`);
    }
    if (plate && plate.trim()) {
      query = query.ilike('plate', `%${plate.trim()}%`);
    }

    const [tripsRes, empRes, escRes, vehRes, areaRes, auditRes] = await Promise.all([
      query,
      supabase.from('employees').select('id, name, position').order('name'),
      supabase.from('escorts').select('id, name, vendor').order('name'),
      supabase.from('vehicles').select('plate').order('plate'),
      tripType === 'FLM'
        ? supabase.from('areas').select('id, name').order('name')
        : Promise.resolve({ data: [] as { id: string; name: string }[] }),
      supabase
        .from('audit_logs')
        .select('id, user_id, action, table_name, record_id, reason, payload, created_at')
        .eq('table_name', 'trips')
        .eq('action', 'admin_correction')
        .order('created_at', { ascending: false })
        .limit(30),
    ]);

    if (tripsRes.error) {
      return NextResponse.json({ error: tripsRes.error.message }, { status: 500 });
    }

    const userIds = Array.from(
      new Set((auditRes.data ?? []).map((a) => a.user_id).filter((x): x is string => Boolean(x)))
    );
    const profileMap = new Map<string, string>();
    if (userIds.length > 0) {
      const { data: profiles } = await adminClient
        .from('profiles')
        .select('id, full_name')
        .in('id', userIds);
      for (const p of profiles ?? []) profileMap.set(p.id, p.full_name);
    }

    return NextResponse.json({
      items: tripsRes.data ?? [],
      employees: empRes.data ?? [],
      escorts: escRes.data ?? [],
      plates: (vehRes.data ?? []).map((v) => v.plate),
      areas: areaRes.data ?? [],
      auditLogs: (auditRes.data ?? []).map((log) => ({
        ...log,
        actor_name: log.user_id ? profileMap.get(log.user_id) ?? 'Admin' : 'Sistem',
      })),
    });
  }

  return NextResponse.json({ error: 'Jenis laporan tidak valid.' }, { status: 400 });
}

export async function PATCH(req: NextRequest) {
  const auth = await requireApiRole(['admin', 'superadmin']);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const body = (await req.json()) as Record<string, unknown>;
  const target = body.target;
  const reason = typeof body.reason === 'string' ? body.reason.trim() : '';

  if (reason.length < 5) {
    return NextResponse.json(
      { error: 'Alasan koreksi wajib diisi (minimal 5 karakter).' },
      { status: 400 }
    );
  }

  const supabase = await createClient();

  if (target === 'attendance') {
    const id = typeof body.id === 'string' ? body.id : '';
    const employeeId = typeof body.employee_id === 'string' ? body.employee_id : '';
    const workDate = typeof body.work_date === 'string' ? body.work_date : '';
    const masukIso = fromWibDatetimeLocal(body.masuk_local as string | null);
    const istirahatIso = fromWibDatetimeLocal(body.istirahat_local as string | null);
    const pulangIso = fromWibDatetimeLocal(body.pulang_local as string | null);

    if (id === 'NEW') {
      if (!employeeId || !workDate) {
        return NextResponse.json({ error: 'Karyawan dan tanggal kerja wajib diisi.' }, { status: 400 });
      }
      const effectiveDate = masukIso ? getWibDateString(masukIso) : workDate;
      const { data: inserted, error: insErr } = await supabase
        .from('attendance')
        .upsert(
          {
            employee_id: employeeId,
            work_date: effectiveDate,
            masuk_at: masukIso,
            istirahat_at: istirahatIso,
            pulang_at: pulangIso,
          },
          { onConflict: 'employee_id,work_date' }
        )
        .select('*')
        .single();

      if (insErr) {
        return NextResponse.json({ error: insErr.message }, { status: 400 });
      }

      await supabase.from('audit_logs').insert({
        user_id: auth.session.userId,
        action: 'admin_correction',
        table_name: 'attendance',
        record_id: inserted.id,
        reason,
        payload: { before: null, after: inserted },
      });

      return NextResponse.json({ item: inserted });
    }

    const { data: beforeRow, error: findErr } = await supabase
      .from('attendance')
      .select('*')
      .eq('id', id)
      .single();

    if (findErr || !beforeRow) {
      return NextResponse.json({ error: 'Data absensi tidak ditemukan.' }, { status: 404 });
    }

    const { data: updated, error: updErr } = await supabase
      .from('attendance')
      .update({
        masuk_at: masukIso,
        istirahat_at: istirahatIso,
        pulang_at: pulangIso,
      })
      .eq('id', id)
      .select('*')
      .single();

    if (updErr) {
      return NextResponse.json({ error: updErr.message }, { status: 400 });
    }

    await supabase.from('audit_logs').insert({
      user_id: auth.session.userId,
      action: 'admin_correction',
      table_name: 'attendance',
      record_id: id,
      reason,
      payload: { before: beforeRow, after: updated },
    });

    return NextResponse.json({ item: updated });
  }

  if (target === 'trip') {
    const id = typeof body.id === 'string' ? body.id : '';
    const { data: beforeRow, error: findErr } = await supabase
      .from('trips')
      .select('*')
      .eq('id', id)
      .single();

    if (findErr || !beforeRow) {
      return NextResponse.json({ error: 'Data trip tidak ditemukan.' }, { status: 404 });
    }

    const departIso = fromWibDatetimeLocal(body.depart_local as string | null) ?? beforeRow.depart_at;
    const returnIso = fromWibDatetimeLocal(body.return_local as string | null);
    const kmStart = Number(body.km_start ?? beforeRow.km_start);
    const kmEnd =
      body.km_end === '' || body.km_end === null || body.km_end === undefined
        ? null
        : Number(body.km_end);
    const plate = normalizePlate(String(body.plate ?? beforeRow.plate));
    const staff2Id = body.staff2_id ? String(body.staff2_id) : null;
    const escortId = body.escort_id ? String(body.escort_id) : null;
    const areaId = beforeRow.trip_type === 'FLM' ? (body.area_id ? String(body.area_id) : beforeRow.area_id) : null;
    const runCode = beforeRow.trip_type !== 'FLM' ? String(body.run_code ?? beforeRow.run_code ?? '').trim() : null;

    if (returnIso && new Date(returnIso).getTime() < new Date(departIso).getTime()) {
      return NextResponse.json(
        { error: 'Waktu kembali tidak boleh lebih awal dari waktu keluar.' },
        { status: 400 }
      );
    }

    if (kmEnd !== null && kmEnd < kmStart) {
      return NextResponse.json(
        { error: 'KM Akhir tidak boleh lebih kecil dari KM Awal.' },
        { status: 400 }
      );
    }

    if (staff2Id && staff2Id === beforeRow.staff1_id) {
      return NextResponse.json(
        { error: 'Staff 2 tidak boleh sama dengan Staff 1.' },
        { status: 400 }
      );
    }

    const { data: updated, error: updErr } = await supabase
      .from('trips')
      .update({
        depart_at: departIso,
        return_at: returnIso,
        staff2_id: staff2Id,
        escort_id: escortId,
        plate,
        km_start: kmStart,
        km_end: kmEnd,
        area_id: areaId,
        run_code: runCode,
      })
      .eq('id', id)
      .select('*')
      .single();

    if (updErr) {
      return NextResponse.json({ error: updErr.message }, { status: 400 });
    }

    await supabase.from('audit_logs').insert({
      user_id: auth.session.userId,
      action: 'admin_correction',
      table_name: 'trips',
      record_id: id,
      reason,
      payload: { before: beforeRow, after: updated },
    });

    return NextResponse.json({ item: updated });
  }

  return NextResponse.json({ error: 'Target koreksi tidak valid.' }, { status: 400 });
}

