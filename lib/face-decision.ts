import { FACE_CONFIG, type FaceConfig } from './face-config';

export interface CandidateMatch {
  subject_id: string;
  n_samples: number;
  d_min: number;
  d_top2: number;
  d_mean: number;
  name?: string;
  subtitle?: string;
  code?: string;
}

export interface LookalikePair {
  subject_a: string;
  subject_b: string;
}

export type DecisionZone = 'accept' | 'confirm' | 'reject';

export interface DecisionResult {
  zone: DecisionZone;
  best: CandidateMatch | null;
  second: CandidateMatch | null;
  score: number | null;
  secondScore: number | null;
  margin: number | null;
  candidates: CandidateMatch[];
  reason?: string;
}

/**
 * Menghitung jarak Euclidean antara dua vektor berdimensi sama.
 */
export function euclideanDistance(v1: number[], v2: number[]): number {
  if (v1.length !== v2.length) return Number.POSITIVE_INFINITY;
  let sum = 0;
  for (let i = 0; i < v1.length; i++) {
    const d = v1[i] - v2[i];
    sum += d * d;
  }
  return Math.sqrt(sum);
}

/**
 * Cek apakah pasangan (idA, idB) terdaftar dalam pasangan wajah mirip.
 */
export function isLookalikePair(
  idA: string,
  idB: string,
  flaggedPairs: LookalikePair[]
): boolean {
  if (!idA || !idB || idA === idB) return false;
  return flaggedPairs.some(
    (p) =>
      (p.subject_a === idA && p.subject_b === idB) ||
      (p.subject_a === idB && p.subject_b === idA)
  );
}

/**
 * Fungsi Murni Keputusan 3 Zona (ACCEPT / CONFIRM / REJECT)
 * Berdasarkan skor d_top2, margin ke kandidat ke-2, dan daftar lookalike flag.
 */
export function decideFaceMatch(
  candidates: CandidateMatch[],
  flaggedPairs: LookalikePair[] = [],
  config: FaceConfig = FACE_CONFIG
): DecisionResult {
  if (!candidates || candidates.length === 0) {
    return {
      zone: 'reject',
      best: null,
      second: null,
      score: null,
      secondScore: null,
      margin: null,
      candidates: [],
      reason: 'no_candidates',
    };
  }

  // Urutkan kandidat berdasarkan skor d_top2 terendah (paling mirip)
  const sorted = [...candidates].sort((a, b) => a.d_top2 - b.d_top2);
  const best = sorted[0];
  const second = sorted.length > 1 ? sorted[1] : null;

  const S1 = best.d_top2;
  const S2 = second ? second.d_top2 : Number.POSITIVE_INFINITY;
  const margin = Number.isFinite(S2) ? S2 - S1 : 999.0;

  // Cek apakah kandidat 1 dan kandidat 2 ditandai sebagai pasangan mirip
  const isFlagged = second
    ? isLookalikePair(best.subject_id, second.subject_id, flaggedPairs)
    : false;

  // 1. ZONA ACCEPT:
  // - Skor S1 <= ACCEPT_MAX_SCORE
  // - Margin >= ACCEPT_MIN_MARGIN
  // - Tidak ada flag lookalike dengan kandidat kedua
  if (
    S1 <= config.ACCEPT_MAX_SCORE &&
    margin >= config.ACCEPT_MIN_MARGIN &&
    !isFlagged
  ) {
    return {
      zone: 'accept',
      best,
      second,
      score: S1,
      secondScore: Number.isFinite(S2) ? S2 : null,
      margin,
      candidates: [best],
    };
  }

  // 2. ZONA CONFIRM:
  // Jika bukan ACCEPT tetapi skor terbaik S1 <= CONFIRM_MAX_SCORE
  if (S1 <= config.CONFIRM_MAX_SCORE) {
    // Tawarkan kandidat yang berada dalam rentang skor [S1, S1 + CANDIDATE_WINDOW] (maks 3 kandidat)
    const qualifyingCandidates = sorted
      .filter((c) => c.d_top2 <= S1 + config.CANDIDATE_WINDOW)
      .slice(0, 3);

    // Jika kandidat 2 ada dan di-flag mirip, pastikan kandidat 2 masuk daftar konfirmasi
    if (second && isFlagged && !qualifyingCandidates.some((c) => c.subject_id === second.subject_id)) {
      if (qualifyingCandidates.length >= 3) {
        qualifyingCandidates[2] = second;
      } else {
        qualifyingCandidates.push(second);
      }
    }

    return {
      zone: 'confirm',
      best,
      second,
      score: S1,
      secondScore: Number.isFinite(S2) ? S2 : null,
      margin,
      candidates: qualifyingCandidates,
      reason: isFlagged
        ? 'lookalike_pair_flagged'
        : margin < config.ACCEPT_MIN_MARGIN
        ? 'ambiguous_margin'
        : 'score_above_accept_threshold',
    };
  }

  // 3. ZONA REJECT:
  return {
    zone: 'reject',
    best,
    second,
    score: S1,
    secondScore: Number.isFinite(S2) ? S2 : null,
    margin,
    candidates: [],
    reason: 'score_exceeds_confirm_threshold',
  };
}

/**
 * Filter Konsistensi Multi-Frame & Rata-rata Descriptor
 * Memeriksa bahwa kumpulan descriptor dari frame kamera konsisten satu sama lain
 * dan membuang frame outlier sebelum dirata-ratakan menjadi 1 query vector (q).
 */
export function filterAndAverageDescriptors(
  descriptors: number[][],
  config: FaceConfig = FACE_CONFIG
): { ok: true; query: number[]; framesUsed: number } | { ok: false; reason: string } {
  if (!descriptors || descriptors.length < config.FRAMES_REQUIRED) {
    return {
      ok: false,
      reason: `Frame kurang dari minimum yang diperlukan (${config.FRAMES_REQUIRED} frame)`,
    };
  }

  // Hitung pairwise distance maksimum antar frame
  let maxPairwiseDist = 0;
  for (let i = 0; i < descriptors.length; i++) {
    for (let j = i + 1; j < descriptors.length; j++) {
      const d = euclideanDistance(descriptors[i], descriptors[j]);
      if (d > maxPairwiseDist) maxPairwiseDist = d;
    }
  }

  // Jika sebaran antar frame terlalu jauh, kemungkinan wajah bergerak cepat atau beda orang
  if (maxPairwiseDist > config.MAX_FRAME_SPREAD) {
    return {
      ok: false,
      reason: `Variasi antar frame tidak konsisten (${maxPairwiseDist.toFixed(2)} > ${config.MAX_FRAME_SPREAD})`,
    };
  }

  // Hitung centroid sementara
  const dim = descriptors[0].length;
  const centroid = new Array<number>(dim).fill(0);
  for (const desc of descriptors) {
    for (let i = 0; i < dim; i++) centroid[i] += desc[i];
  }
  for (let i = 0; i < dim; i++) centroid[i] /= descriptors.length;

  // Filter outlier yang jaraknya > 0.25 dari centroid
  const valid = descriptors.filter((d) => euclideanDistance(d, centroid) <= 0.25);
  if (valid.length < 3) {
    return {
      ok: false,
      reason: 'Terlalu banyak frame outlier',
    };
  }

  // Rata-ratakan frame valid yang tersisa
  const finalQuery = new Array<number>(dim).fill(0);
  for (const desc of valid) {
    for (let i = 0; i < dim; i++) finalQuery[i] += desc[i];
  }
  for (let i = 0; i < dim; i++) finalQuery[i] /= valid.length;

  return {
    ok: true,
    query: finalQuery,
    framesUsed: valid.length,
  };
}

/**
 * Menghitung vektor centroid rata-rata dari kumpulan vektor berdimensi sama.
 */
export function computeCentroid(vectors: number[][]): number[] {
  if (!vectors || vectors.length === 0) return [];
  const dim = vectors[0].length;
  const centroid = new Array<number>(dim).fill(0);
  for (const v of vectors) {
    for (let i = 0; i < dim; i++) {
      centroid[i] += v[i];
    }
  }
  for (let i = 0; i < dim; i++) {
    centroid[i] /= vectors.length;
  }
  return centroid;
}

/**
 * Memeriksa konsistensi internal sampel pendaftaran wajah (Fase 5)
 * Jarak tiap sampel ke centroid dirinya sendiri tidak boleh melebihi maxOutlierDist.
 */
export function checkInternalConsistency(
  samples: { descriptor: number[]; sample_label?: string }[],
  maxOutlierDist: number = FACE_CONFIG.ENROLL_MAX_OUTLIER_DIST
): {
  ok: boolean;
  centroid: number[];
  outlierIndices: number[];
  distances: number[];
} {
  if (!samples || samples.length < 2) {
    return {
      ok: true,
      centroid: samples?.[0]?.descriptor ?? [],
      outlierIndices: [],
      distances: [0],
    };
  }

  const descriptors = samples.map((s) => s.descriptor);
  const centroid = computeCentroid(descriptors);
  const distances = descriptors.map((d) => euclideanDistance(d, centroid));
  const outlierIndices: number[] = [];

  for (let i = 0; i < distances.length; i++) {
    if (distances[i] > maxOutlierDist) {
      outlierIndices.push(i);
    }
  }

  return {
    ok: outlierIndices.length === 0,
    centroid,
    outlierIndices,
    distances,
  };
}
