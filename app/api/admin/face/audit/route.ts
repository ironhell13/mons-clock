import { NextResponse, type NextRequest } from 'next/server';
import { requireApiRole } from '@/lib/auth';
import { createAdminClient } from '@/lib/supabase/admin';
import { getActiveFaceConfig } from '@/lib/face-config';
import {
  computeCentroid,
  euclideanDistance,
  isLookalikePair,
  type LookalikePair,
} from '@/lib/face-decision';

export async function GET(req: NextRequest) {
  const auth = await requireApiRole(['superadmin']);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const { searchParams } = new URL(req.url);
  const subjectTypeFilter = searchParams.get('subject_type') || 'all';

  const adminClient = createAdminClient();
  const config = getActiveFaceConfig();

  // 1. Ambil seluruh template wajah
  let query = adminClient
    .from('face_templates')
    .select('id, subject_type, employee_id, escort_id, descriptor, pipeline_version, quality, created_at');

  if (subjectTypeFilter !== 'all') {
    query = query.eq('subject_type', subjectTypeFilter);
  }

  const { data: templates, error: tplErr } = await query;
  if (tplErr) {
    return NextResponse.json({ error: tplErr.message }, { status: 500 });
  }

  // 2. Ambil semua profil karyawan dan pengawal
  const [employeesRes, escortsRes, lookalikeRes] = await Promise.all([
    adminClient.from('employees').select('id, name, employee_no, is_active, positions:position_id(name)'),
    adminClient.from('escorts').select('id, name, vendor, is_active'),
    adminClient.from('face_lookalike_flags').select('id, subject_a, subject_b, subject_type'),
  ]);

  const empMap = new Map<string, { name: string; subtitle: string; code: string; is_active: boolean }>();
  for (const e of employeesRes.data ?? []) {
    const pos = (e.positions as unknown as { name: string } | null)?.name ?? 'Staff';
    empMap.set(e.id, {
      name: e.name,
      subtitle: pos,
      code: e.employee_no,
      is_active: e.is_active,
    });
  }

  const escortMap = new Map<string, { name: string; subtitle: string; code: string; is_active: boolean }>();
  for (const esc of escortsRes.data ?? []) {
    escortMap.set(esc.id, {
      name: esc.name,
      subtitle: `Vendor: ${esc.vendor}`,
      code: '-',
      is_active: esc.is_active,
    });
  }

  const flaggedList: { id: string; subject_a: string; subject_b: string; subject_type: string }[] =
    lookalikeRes.data ?? [];
  const flaggedPairs: LookalikePair[] = flaggedList.map((f) => ({
    subject_a: f.subject_a,
    subject_b: f.subject_b,
  }));

  // 3. Kelompokkan template per orang
  interface PersonData {
    id: string;
    subject_type: 'employee' | 'escort';
    name: string;
    subtitle: string;
    code: string;
    descriptors: number[][];
    centroid: number[];
    internalSpread: number;
    sampleCount: number;
    pipelineVersions: number[];
  }

  const personMap = new Map<string, PersonData>();

  for (const tpl of templates ?? []) {
    const sid = (tpl.employee_id || tpl.escort_id) as string;
    if (!sid || !Array.isArray(tpl.descriptor) || tpl.descriptor.length !== 128) continue;

    const stype = tpl.subject_type as 'employee' | 'escort';
    const profile = stype === 'employee' ? empMap.get(sid) : escortMap.get(sid);
    const name = profile?.name ?? 'Tidak Dikenal';
    const subtitle = profile?.subtitle ?? '-';
    const code = profile?.code ?? '-';

    let item = personMap.get(sid);
    if (!item) {
      item = {
        id: sid,
        subject_type: stype,
        name,
        subtitle,
        code,
        descriptors: [],
        centroid: [],
        internalSpread: 0,
        sampleCount: 0,
        pipelineVersions: [],
      };
      personMap.set(sid, item);
    }
    item.descriptors.push(tpl.descriptor);
    if (tpl.pipeline_version) item.pipelineVersions.push(tpl.pipeline_version);
  }

  // Hitung centroid dan internal spread per orang
  for (const person of personMap.values()) {
    person.sampleCount = person.descriptors.length;
    person.centroid = computeCentroid(person.descriptors);

    // Hitung jarak maksimum antar sampel orang ini
    let maxInternal = 0;
    for (let i = 0; i < person.descriptors.length; i++) {
      for (let j = i + 1; j < person.descriptors.length; j++) {
        const d = euclideanDistance(person.descriptors[i], person.descriptors[j]);
        if (d > maxInternal) maxInternal = d;
      }
    }
    person.internalSpread = Number(maxInternal.toFixed(3));
  }

  const people = Array.from(personMap.values());

  // 4. Hitung jarak pairwise antar orang berbeda
  interface PairSimilarity {
    personA: { id: string; name: string; subject_type: string; subtitle: string };
    personB: { id: string; name: string; subject_type: string; subtitle: string };
    distance: number;
    is_flagged: boolean;
    flag_id?: string;
  }

  const allPairs: PairSimilarity[] = [];
  const histogramBuckets = {
    under_040: 0,
    range_040_045: 0,
    range_045_050: 0,
    range_050_055: 0,
    range_055_060: 0,
    over_060: 0,
  };

  // Peta tetangga terdekat per orang
  const nearestNeighborMap = new Map<string, { id: string; name: string; distance: number }>();

  for (let i = 0; i < people.length; i++) {
    for (let j = i + 1; j < people.length; j++) {
      const p1 = people[i];
      const p2 = people[j];

      // Hanya bandingkan yang bertipe sama (karyawan vs karyawan, pengawal vs pengawal)
      if (p1.subject_type !== p2.subject_type) continue;

      const dist = Number(euclideanDistance(p1.centroid, p2.centroid).toFixed(3));

      // Update histogram
      if (dist < 0.40) histogramBuckets.under_040++;
      else if (dist < 0.45) histogramBuckets.range_040_045++;
      else if (dist < 0.45) histogramBuckets.range_045_050++;
      else if (dist < 0.55) histogramBuckets.range_050_055++;
      else if (dist < 0.60) histogramBuckets.range_055_060++;
      else histogramBuckets.over_060++;

      // Update nearest neighbor p1
      const curP1 = nearestNeighborMap.get(p1.id);
      if (!curP1 || dist < curP1.distance) {
        nearestNeighborMap.set(p1.id, { id: p2.id, name: p2.name, distance: dist });
      }

      // Update nearest neighbor p2
      const curP2 = nearestNeighborMap.get(p2.id);
      if (!curP2 || dist < curP2.distance) {
        nearestNeighborMap.set(p2.id, { id: p1.id, name: p1.name, distance: dist });
      }

      // Cek lookalike flag
      const flaggedRow = flaggedList.find(
        (f) =>
          (f.subject_a === p1.id && f.subject_b === p2.id) ||
          (f.subject_a === p2.id && f.subject_b === p1.id)
      );

      allPairs.push({
        personA: { id: p1.id, name: p1.name, subject_type: p1.subject_type, subtitle: p1.subtitle },
        personB: { id: p2.id, name: p2.name, subject_type: p2.subject_type, subtitle: p2.subtitle },
        distance: dist,
        is_flagged: Boolean(flaggedRow),
        flag_id: flaggedRow?.id,
      });
    }
  }

  // Urutkan pasangan paling mirip (jarak terkecil di atas)
  allPairs.sort((a, b) => a.distance - b.distance);
  const top20Pairs = allPairs.slice(0, 20);

  // 5. Hitung status per orang
  const personStats = people.map((p) => {
    const nn = nearestNeighborMap.get(p.id);
    let status: 'Aman' | 'Rawan' | 'Perlu daftar ulang' = 'Aman';
    let statusReason = 'Profil stabil dan aman.';

    if (p.sampleCount < 3 || p.internalSpread > config.ENROLL_MAX_OUTLIER_DIST) {
      status = 'Perlu daftar ulang';
      statusReason =
        p.sampleCount < 3
          ? `Sampel wajah terlalu sedikit (${p.sampleCount} sampel). Disarankan 5 pose.`
          : `Sebaran internal tinggi (${p.internalSpread} > ${config.ENROLL_MAX_OUTLIER_DIST}). Wajah antar sampel tidak konsisten.`;
    } else if (nn && nn.distance < config.ENROLL_LOOKALIKE_GUARD) {
      const isFlagged = isLookalikePair(p.id, nn.id, flaggedPairs);
      if (isFlagged) {
        status = 'Rawan';
        statusReason = `Wajah mirip dengan ${nn.name} (${nn.distance}). Sudah ditandai admin (selalu verifikasi zona konfirmasi).`;
      } else {
        status = 'Rawan';
        statusReason = `Wajah mirip dengan ${nn.name} (${nn.distance} < ${config.ENROLL_LOOKALIKE_GUARD}). Belum ditandai admin.`;
      }
    }

    return {
      id: p.id,
      name: p.name,
      subtitle: p.subtitle,
      code: p.code,
      subject_type: p.subject_type,
      sample_count: p.sampleCount,
      internal_spread: p.internalSpread,
      nearest_name: nn?.name ?? '-',
      nearest_distance: nn?.distance ?? null,
      status,
      status_reason: statusReason,
    };
  });

  // Urutkan orang: 'Perlu daftar ulang' dulu, lalu 'Rawan', lalu 'Aman'
  const statusPriority = { 'Perlu daftar ulang': 0, Rawan: 1, Aman: 2 };
  personStats.sort((a, b) => {
    const pA = statusPriority[a.status];
    const pB = statusPriority[b.status];
    if (pA !== pB) return pA - pB;
    return (a.nearest_distance ?? 99) - (b.nearest_distance ?? 99);
  });

  // 6. Ringkasan Global & Saran Threshold
  const minDistance = allPairs.length > 0 ? allPairs[0].distance : null;
  const safeCount = personStats.filter((p) => p.status === 'Aman').length;
  const vulnerableCount = personStats.filter((p) => p.status === 'Rawan').length;
  const needsReEnrollCount = personStats.filter((p) => p.status === 'Perlu daftar ulang').length;

  let thresholdAdvice = {
    alert: false,
    message: 'Konfigurasi ambang batas saat ini dalam kondisi optimal.',
    recommended_accept_max: config.ACCEPT_MAX_SCORE,
  };

  if (minDistance !== null && minDistance - config.ACCEPT_MAX_SCORE < 0.08) {
    const suggested = Math.max(0.32, Number((minDistance - 0.08).toFixed(2)));
    thresholdAdvice = {
      alert: true,
      message: `Jarak antar-wajah terkecil (${minDistance.toFixed(3)}) terlalu dekat dengan ambang ACCEPT_MAX_SCORE (${config.ACCEPT_MAX_SCORE}). Disarankan menurunkan ACCEPT_MAX_SCORE menjadi ${suggested} atau menandai pasangan teratas sebagai wajah mirip.`,
      recommended_accept_max: suggested,
    };
  }

  return NextResponse.json({
    summary: {
      total_people: people.length,
      safe_count: safeCount,
      vulnerable_count: vulnerableCount,
      needs_re_enroll_count: needsReEnrollCount,
      min_distance: minDistance,
      histogram: histogramBuckets,
      threshold_advice: thresholdAdvice,
    },
    top_pairs: top20Pairs,
    person_stats: personStats,
    active_config: config,
  });
}

