import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { requireApiRole } from '@/lib/auth';
import { createAdminClient } from '@/lib/supabase/admin';
import { getActiveFaceConfig } from '@/lib/face-config';
import {
  decideFaceMatch,
  filterAndAverageDescriptors,
  type CandidateMatch,
  type LookalikePair,
} from '@/lib/face-decision';
import { matchFacesServer, saveFaceVerification } from '@/lib/face-verify';
import type { FaceVerificationCandidate } from '@/types/database';

const verifyRequestSchema = z.object({
  purpose: z.enum(['absen', 'trip_staff1', 'trip_staff2', 'trip_escort']),
  subject_type: z.enum(['employee', 'escort', 'all']).optional(),
  descriptors: z
    .array(
      z
        .array(z.number())
        .length(128, 'Descriptor wajah harus tepat 128 dimensi.')
    )
    .min(1, 'Minimal 1 frame descriptor diperlukan.'),
});

export async function POST(req: NextRequest) {
  const auth = await requireApiRole(['absen', 'admin', 'hrd', 'superadmin']);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const body = (await req.json()) as Record<string, unknown>;
  const parsed = verifyRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.errors[0]?.message ?? 'Permintaan verifikasi tidak valid.' },
      { status: 400 }
    );
  }

  const { purpose, descriptors } = parsed.data;
  const requestedSubjectType = parsed.data.subject_type;
  // Jika tujuan adalah absensi, cari di kedua tabel (karyawan & pengawal)
  const searchSubjectType = purpose === 'absen' ? 'all' : (requestedSubjectType ?? 'employee');

  const config = getActiveFaceConfig();
  const adminClient = createAdminClient();

  // 1. Validasi konsistensi multi-frame dan hitung query vector rata-rata
  const multiFrame = filterAndAverageDescriptors(descriptors, config);
  if (!multiFrame.ok) {
    return NextResponse.json({
      status: 'retry',
      reason: multiFrame.reason,
    });
  }

  const queryVector = multiFrame.query;
  const framesUsed = multiFrame.framesUsed;

  // 2. Query kandidat terbaik di database (lewat RPC match_faces atau fallback)
  const [matches, lookalikeRes, empListRes, escListRes] = await Promise.all([
    matchFacesServer(adminClient, queryVector, searchSubjectType),
    searchSubjectType === 'all'
      ? adminClient.from('face_lookalike_flags').select('subject_a, subject_b')
      : adminClient
          .from('face_lookalike_flags')
          .select('subject_a, subject_b')
          .eq('subject_type', searchSubjectType),
    searchSubjectType === 'escort'
      ? Promise.resolve({ data: [] })
      : adminClient
          .from('employees')
          .select('id, name, position, employee_no')
          .eq('is_active', true),
    searchSubjectType === 'employee'
      ? Promise.resolve({ data: [] })
      : adminClient
          .from('escorts')
          .select('id, name, vendor, nig')
          .eq('is_active', true),
  ]);

  const flaggedPairs: LookalikePair[] = (lookalikeRes.data ?? []).map((row) => ({
    subject_a: row.subject_a,
    subject_b: row.subject_b,
  }));

  const subjectMap = new Map<
    string,
    { name: string; subtitle: string; code?: string; subject_type: 'employee' | 'escort' }
  >();

  for (const s of (empListRes.data ?? []) as {
    id: string;
    name: string;
    position?: string;
    employee_no?: string;
  }[]) {
    subjectMap.set(s.id, {
      name: s.name,
      subtitle: s.position ?? '',
      code: s.employee_no,
      subject_type: 'employee',
    });
  }

  for (const s of (escListRes.data ?? []) as {
    id: string;
    name: string;
    vendor?: string;
    nig?: string;
  }[]) {
    subjectMap.set(s.id, {
      name: s.name,
      subtitle: s.vendor ?? '',
      code: s.nig,
      subject_type: 'escort',
    });
  }

  const candidates: CandidateMatch[] = matches.map((m) => {
    const meta = subjectMap.get(m.subject_id);
    return {
      ...m,
      name: meta?.name ?? 'Tidak Dikenal',
      subtitle: meta?.subtitle ?? '',
      code: meta?.code,
      subject_type: meta?.subject_type ?? (m.subject_type as 'employee' | 'escort' | undefined),
    };
  });

  // 3. Putuskan zona identitas (ACCEPT / CONFIRM / REJECT)
  const decision = decideFaceMatch(candidates, flaggedPairs, config);

  // 4. Proses berdasarkan zona hasil keputusan
  if (decision.zone === 'accept' && decision.best) {
    const bestMeta = subjectMap.get(decision.best.subject_id);
    const resolvedSubjectType =
      bestMeta?.subject_type ?? (purpose === 'trip_escort' ? 'escort' : 'employee');

    const { verificationId } = await saveFaceVerification(adminClient, {
      kioskUserId: auth.session.userId,
      purpose,
      subjectType: resolvedSubjectType,
      subjectId: decision.best.subject_id,
      zone: 'accept',
      score: decision.score,
      secondSubjectId: decision.second?.subject_id ?? null,
      secondScore: decision.secondScore,
      margin: decision.margin,
      framesUsed,
      candidates: [
        {
          id: decision.best.subject_id,
          name: bestMeta?.name ?? 'Tidak Dikenal',
          subtitle: bestMeta?.subtitle ?? '',
          code: bestMeta?.code,
          score: decision.score ?? undefined,
        },
      ],
    });

    return NextResponse.json({
      status: 'accepted',
      verification_id: verificationId,
      subject: {
        id: decision.best.subject_id,
        name: bestMeta?.name ?? 'Tidak Dikenal',
        subtitle: bestMeta?.subtitle ?? '',
        code: bestMeta?.code,
        subject_type: resolvedSubjectType,
      },
      score: decision.score,
      margin: decision.margin,
    });
  }

  if (decision.zone === 'confirm' && decision.candidates.length > 0) {
    const candidatesList: FaceVerificationCandidate[] = decision.candidates.map((c) => ({
      id: c.subject_id,
      name: c.name ?? 'Kandidat',
      subtitle: c.subtitle ?? '',
      code: c.code,
      score: c.d_top2,
    }));

    // Simpan ke face_verifications dengan subject_id masih null
    const { verificationId } = await saveFaceVerification(adminClient, {
      kioskUserId: auth.session.userId,
      purpose,
      subjectType: requestedSubjectType === 'escort' ? 'escort' : 'employee',
      subjectId: null,
      zone: 'confirm',
      score: decision.score,
      secondSubjectId: decision.second?.subject_id ?? null,
      secondScore: decision.secondScore,
      margin: decision.margin,
      framesUsed,
      candidates: candidatesList,
    });

    // Acak urutan kandidat saat dikirim ke browser agar urutan tidak membocorkan skor
    const shuffled = [...candidatesList]
      .map((item) => ({ item, sort: Math.random() }))
      .sort((a, b) => a.sort - b.sort)
      .map(({ item }) => ({
        id: item.id,
        name: item.name,
        subtitle: item.subtitle,
      }));

    return NextResponse.json({
      status: 'confirm',
      verification_id: verificationId,
      candidates: shuffled,
      reason: decision.reason,
    });
  }

  // ZONA REJECT:
  return NextResponse.json({
    status: 'rejected',
    reason: decision.reason ?? 'not_found',
    bestScore: decision.score,
  });
}

