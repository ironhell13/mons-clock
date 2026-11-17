import type { SupabaseClient } from '@supabase/supabase-js';
import { getActiveFaceConfig } from './face-config';
import type {
  DecisionZone,
  FaceVerification,
  FaceVerificationCandidate,
  SubjectType,
  VerificationPurpose,
} from '@/types/database';
import { euclideanDistance } from './face-decision';

export interface VerificationResultPayload {
  id: string;
  subject_type: SubjectType;
  subject_id: string;
  name: string;
  subtitle: string;
  code?: string;
  score: number | null;
  second_subject_id: string | null;
  second_score: number | null;
  margin: number | null;
  decision_zone: DecisionZone;
  frames_used: number;
}

/**
 * Fallback server-side matching jika RPC match_faces pgvector belum dijalankan di Supabase.
 * Menghitung d_top2 persis seperti yang dilakukan fungsi SQL.
 */
export async function matchFacesFallback(
  adminClient: SupabaseClient,
  query: number[],
  subjectType: SubjectType
): Promise<{
  subject_id: string;
  n_samples: number;
  d_min: number;
  d_top2: number;
  d_mean: number;
}[]> {
  const { data: templates, error } = await adminClient
    .from('face_templates')
    .select('id, subject_type, employee_id, escort_id, descriptor')
    .eq('subject_type', subjectType);

  if (error || !templates || templates.length === 0) {
    return [];
  }

  const grouped = new Map<string, number[]>();

  for (const tpl of templates) {
    const sid = (tpl.employee_id || tpl.escort_id) as string;
    if (!sid || !Array.isArray(tpl.descriptor) || tpl.descriptor.length !== 128) continue;

    const dist = euclideanDistance(query, tpl.descriptor);
    const existing = grouped.get(sid) ?? [];
    existing.push(dist);
    grouped.set(sid, existing);
  }

  const results: {
    subject_id: string;
    n_samples: number;
    d_min: number;
    d_top2: number;
    d_mean: number;
  }[] = [];

  for (const [sid, dists] of grouped.entries()) {
    dists.sort((a, b) => a - b);
    const n = dists.length;
    const dMin = dists[0];
    const top2 = dists.slice(0, 2);
    const dTop2 = top2.reduce((acc, v) => acc + v, 0) / top2.length;
    const dMean = dists.reduce((acc, v) => acc + v, 0) / n;

    results.push({
      subject_id: sid,
      n_samples: n,
      d_min: dMin,
      d_top2: dTop2,
      d_mean: dMean,
    });
  }

  results.sort((a, b) => a.d_top2 - b.d_top2);
  return results.slice(0, 8);
}

/**
 * Melakukan matching wajah di server dengan mencoba RPC match_faces (pgvector)
 * dan fallback ke perhitungan JavaScript in-memory jika RPC belum tersedia.
 */
export async function matchFacesServer(
  adminClient: SupabaseClient,
  query: number[],
  subjectType: SubjectType
) {
  try {
    // Format query vector untuk pgvector: '[0.123, -0.456, ...]'
    const vectorStr = `[${query.join(',')}]`;
    const { data, error } = await adminClient.rpc('match_faces', {
      q: vectorStr,
      p_subject_type: subjectType,
    });

    if (!error && Array.isArray(data)) {
      return data as {
        subject_id: string;
        n_samples: number;
        d_min: number;
        d_top2: number;
        d_mean: number;
      }[];
    }
  } catch {
    // Abaikan dan gunakan fallback
  }

  return matchFacesFallback(adminClient, query, subjectType);
}

/**
 * Menyimpan verifikasi identitas di database tabel public.face_verifications.
 */
export async function saveFaceVerification(
  adminClient: SupabaseClient,
  params: {
    kioskUserId: string;
    purpose: VerificationPurpose;
    subjectType: SubjectType;
    subjectId: string | null;
    zone: 'accept' | 'confirm' | 'reject';
    score: number | null;
    secondSubjectId: string | null;
    secondScore: number | null;
    margin: number | null;
    framesUsed: number;
    candidates: FaceVerificationCandidate[];
  }
): Promise<{ verificationId: string; expiresAt: string }> {
  const config = getActiveFaceConfig();
  const ttlSec = params.purpose === 'absen' ? config.TTL_ABSEN_SEC : config.TTL_TRIP_SEC;
  const now = new Date();
  const expiresAt = new Date(now.getTime() + ttlSec * 1000).toISOString();

  const { data, error } = await adminClient
    .from('face_verifications')
    .insert({
      kiosk_user_id: params.kioskUserId,
      purpose: params.purpose,
      subject_type: params.subjectType,
      subject_id: params.subjectId,
      zone: params.zone,
      score: params.score,
      second_subject_id: params.secondSubjectId,
      second_score: params.secondScore,
      margin: params.margin,
      frames_used: params.framesUsed,
      candidates: params.candidates,
      confirm_attempts: 0,
      confirmed_method: null,
      expires_at: expiresAt,
    })
    .select('id, expires_at')
    .single();

  if (error || !data) {
    throw new Error(`Gagal menyimpan verifikasi wajah: ${error?.message ?? 'Unknown'}`);
  }

  return { verificationId: data.id, expiresAt: data.expires_at };
}

/**
 * Konsumsi verifikasi identitas sekali pakai (Single-Use Verification Token).
 * Hanya verifikasi yang valid, belum kadaluarsa, dan cocok dengan sesi kiosk yang dapat dikonsumsi.
 */
export async function consumeVerification(
  adminClient: SupabaseClient,
  params: {
    verificationId: string;
    kioskUserId: string;
    purpose: VerificationPurpose;
    consume?: boolean; // Default true: set consumed_at = now()
  }
): Promise<
  | { ok: true; verification: FaceVerification; subject: { id: string; name: string; subtitle: string; code?: string } }
  | { ok: false; error: string; status: number }
> {
  const { verificationId, kioskUserId, purpose, consume = true } = params;
  const now = new Date();
  const nowIso = now.toISOString();

  // 1. Ambil baris verifikasi
  const { data: row, error } = await adminClient
    .from('face_verifications')
    .select('*')
    .eq('id', verificationId)
    .maybeSingle();

  if (error || !row) {
    return { ok: false, error: 'Token verifikasi wajah tidak ditemukan atau tidak valid.', status: 404 };
  }

  const verification = row as FaceVerification;

  // 2. Validasi kepemilikan kiosk
  if (verification.kiosk_user_id !== kioskUserId) {
    return { ok: false, error: 'Token verifikasi tidak berasal dari perangkat pos yang sama.', status: 403 };
  }

  // 3. Validasi tujuan (purpose)
  if (verification.purpose !== purpose) {
    return {
      ok: false,
      error: `Tujuan verifikasi tidak sesuai (${verification.purpose} != ${purpose}).`,
      status: 400,
    };
  }

  // 4. Validasi kadaluarsa
  if (new Date(verification.expires_at) < now) {
    return { ok: false, error: 'Token verifikasi wajah telah kedaluwarsa. Silakan scan ulang.', status: 410 };
  }

  // 5. Validasi penggunaan ganda
  if (verification.consumed_at) {
    return {
      ok: false,
      error: 'Token verifikasi ini telah digunakan sebelumnya. Silakan scan ulang.',
      status: 409,
    };
  }

  // 6. Validasi bahwa identitas telah disetujui (ACCEPT atau sudah CONFIRMED)
  if (!verification.subject_id) {
    return {
      ok: false,
      error: 'Identitas wajah belum dikonfirmasi. Silakan selesaikan konfirmasi identitas terlebih dahulu.',
      status: 400,
    };
  }

  // 7. Ambil profil subjek (karyawan atau pengawal)
  let subjectInfo: { id: string; name: string; subtitle: string; code?: string } | null = null;
  if (verification.subject_type === 'employee') {
    const { data: emp } = await adminClient
      .from('employees')
      .select('id, name, position, employee_no, is_active')
      .eq('id', verification.subject_id)
      .maybeSingle();

    if (!emp || !emp.is_active) {
      return { ok: false, error: 'Karyawan tidak ditemukan atau berstatus nonaktif.', status: 404 };
    }
    subjectInfo = {
      id: emp.id,
      name: emp.name,
      subtitle: emp.position,
      code: emp.employee_no,
    };
  } else {
    const { data: esc } = await adminClient
      .from('escorts')
      .select('id, name, vendor, is_active')
      .eq('id', verification.subject_id)
      .maybeSingle();

    if (!esc || !esc.is_active) {
      return { ok: false, error: 'Pengawal tidak ditemukan atau berstatus nonaktif.', status: 404 };
    }
    subjectInfo = {
      id: esc.id,
      name: esc.name,
      subtitle: esc.vendor,
    };
  }

  // 8. Tandai verifikasi sebagai telah dikonsumsi (atomic update)
  if (consume) {
    const { data: updated, error: updErr } = await adminClient
      .from('face_verifications')
      .update({ consumed_at: nowIso })
      .eq('id', verificationId)
      .is('consumed_at', null)
      .select('*')
      .single();

    if (updErr || !updated) {
      return {
        ok: false,
        error: 'Gagal mengonsumsi token verifikasi (kemungkinan sedang dipakai secara bersamaan).',
        status: 409,
      };
    }
  }

  return {
    ok: true,
    verification,
    subject: subjectInfo,
  };
}

