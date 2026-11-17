import { describe, it, expect } from 'vitest';
import {
  decideFaceMatch,
  filterAndAverageDescriptors,
  checkInternalConsistency,
  type CandidateMatch,
  type LookalikePair,
} from '../face-decision';
import { FACE_CONFIG } from '../face-config';

describe('Face Decision Engine (decideFaceMatch)', () => {
  it('harus ACCEPT jika kecocokan jelas (skor rendah & margin tinggi)', () => {
    const candidates: CandidateMatch[] = [
      {
        subject_id: 'emp-1',
        n_samples: 5,
        d_min: 0.22,
        d_top2: 0.25,
        d_mean: 0.28,
        name: 'Budi Santoso',
      },
      {
        subject_id: 'emp-2',
        n_samples: 5,
        d_min: 0.42,
        d_top2: 0.45,
        d_mean: 0.48,
        name: 'Agus Wijaya',
      },
    ];

    const result = decideFaceMatch(candidates, [], FACE_CONFIG);
    expect(result.zone).toBe('accept');
    expect(result.best?.subject_id).toBe('emp-1');
    expect(result.score).toBe(0.25);
    expect(result.margin).toBeCloseTo(0.20, 2);
    expect(result.candidates).toHaveLength(1);
  });

  it('harus CONFIRM jika dua orang mirip (margin tipis < 0.10)', () => {
    const candidates: CandidateMatch[] = [
      {
        subject_id: 'emp-1',
        n_samples: 5,
        d_min: 0.31,
        d_top2: 0.33,
        d_mean: 0.35,
        name: 'Rian Pratama',
      },
      {
        subject_id: 'emp-2',
        n_samples: 5,
        d_min: 0.33,
        d_top2: 0.36,
        d_mean: 0.39,
        name: 'Rian Hidayat',
      },
    ];

    const result = decideFaceMatch(candidates, [], FACE_CONFIG);
    expect(result.zone).toBe('confirm');
    expect(result.best?.subject_id).toBe('emp-1');
    expect(result.margin).toBeCloseTo(0.03, 2);
    // Kedua kandidat harus ditawarkan untuk konfirmasi
    expect(result.candidates.map((c) => c.subject_id)).toContain('emp-1');
    expect(result.candidates.map((c) => c.subject_id)).toContain('emp-2');
  });

  it('harus REJECT jika orang tidak dikenal (skor > CONFIRM_MAX_SCORE)', () => {
    const candidates: CandidateMatch[] = [
      {
        subject_id: 'emp-1',
        n_samples: 5,
        d_min: 0.48,
        d_top2: 0.52,
        d_mean: 0.55,
      },
    ];

    const result = decideFaceMatch(candidates, [], FACE_CONFIG);
    expect(result.zone).toBe('reject');
    expect(result.score).toBe(0.52);
    expect(result.candidates).toHaveLength(0);
  });

  it('tidak membiarkan orang bersampel banyak menang hanya karena 1 sampel kebetulan dekat (efek d_top2)', () => {
    // emp-banyak punya 10 sampel, salah satunya kebetulan d_min = 0.28, tapi sampel kedua 0.42 (d_top2 = 0.35)
    // emp-sedikit punya 3 sampel konsisten (d_min = 0.30, d_top2 = 0.31)
    const candidates: CandidateMatch[] = [
      {
        subject_id: 'emp-sedikit',
        n_samples: 3,
        d_min: 0.30,
        d_top2: 0.31,
        d_mean: 0.32,
      },
      {
        subject_id: 'emp-banyak',
        n_samples: 10,
        d_min: 0.28,
        d_top2: 0.35,
        d_mean: 0.45,
      },
    ];

    const result = decideFaceMatch(candidates, [], FACE_CONFIG);
    // emp-sedikit harus menjadi peringkat pertama karena d_top2 lebih rendah
    expect(result.best?.subject_id).toBe('emp-sedikit');
  });

  it('pasangan di face_lookalike_flags tidak pernah ACCEPT (wajib CONFIRM)', () => {
    const candidates: CandidateMatch[] = [
      {
        subject_id: 'kembar-a',
        n_samples: 5,
        d_min: 0.25,
        d_top2: 0.28,
        d_mean: 0.30,
        name: 'Kembar A',
      },
      {
        subject_id: 'kembar-b',
        n_samples: 5,
        d_min: 0.38,
        d_top2: 0.40,
        d_mean: 0.43,
        name: 'Kembar B',
      },
    ];

    const flagged: LookalikePair[] = [
      { subject_a: 'kembar-a', subject_b: 'kembar-b' },
    ];

    // Margin = 0.12 (biasanya lolos accept), tapi karena di-flag, harus CONFIRM
    const result = decideFaceMatch(candidates, flagged, FACE_CONFIG);
    expect(result.zone).toBe('confirm');
    expect(result.reason).toBe('lookalike_pair_flagged');
    expect(result.candidates.map((c) => c.subject_id)).toContain('kembar-a');
    expect(result.candidates.map((c) => c.subject_id)).toContain('kembar-b');
  });

  it('menangani kasus hanya 1 orang terdaftar di database', () => {
    const singleCandidate: CandidateMatch[] = [
      {
        subject_id: 'only-one',
        n_samples: 5,
        d_min: 0.24,
        d_top2: 0.26,
        d_mean: 0.28,
      },
    ];

    const resAccept = decideFaceMatch(singleCandidate, [], FACE_CONFIG);
    expect(resAccept.zone).toBe('accept');
    expect(resAccept.margin).toBe(999);

    const singleFar: CandidateMatch[] = [
      {
        subject_id: 'only-one',
        n_samples: 5,
        d_min: 0.48,
        d_top2: 0.50,
        d_mean: 0.52,
      },
    ];
    const resReject = decideFaceMatch(singleFar, [], FACE_CONFIG);
    expect(resReject.zone).toBe('reject');
  });
});

describe('Multi-Frame Consistency (filterAndAverageDescriptors)', () => {
  const makeVector = (val: number) => new Array(128).fill(val);

  it('harus menerima frame yang konsisten satu sama lain', () => {
    // 4 vektor identik/sangat mirip
    const frames = [
      makeVector(0.1),
      makeVector(0.101),
      makeVector(0.102),
      makeVector(0.099),
    ];

    const res = filterAndAverageDescriptors(frames, FACE_CONFIG);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.framesUsed).toBe(4);
      expect(res.query[0]).toBeCloseTo(0.1, 2);
    }
  });

  it('harus menolak jika variasi antar frame melebihi batas (MAX_FRAME_SPREAD)', () => {
    // Vektor dengan jarak sangat jauh (misal subjek berubah saat scan)
    const frames = [
      makeVector(0.1),
      makeVector(0.1),
      makeVector(0.9), // jarak sangat jauh
      makeVector(0.1),
    ];

    const res = filterAndAverageDescriptors(frames, FACE_CONFIG);
    expect(res.ok).toBe(false);
  });

  it('harus menerima 1 frame flash capture berkualitas tinggi jika FRAMES_REQUIRED = 1', () => {
    const frames = [makeVector(0.15)];
    const res = filterAndAverageDescriptors(frames, FACE_CONFIG);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.framesUsed).toBe(1);
      expect(res.query[0]).toBeCloseTo(0.15, 2);
    }
  });

  it('harus menolak jika jumlah frame kurang dari FRAMES_REQUIRED', () => {
    const frames = [makeVector(0.1)];
    const res = filterAndAverageDescriptors(frames, { ...FACE_CONFIG, FRAMES_REQUIRED: 2 });
    expect(res.ok).toBe(false);
  });
});

describe('Konsistensi Internal Enrollment (checkInternalConsistency)', () => {
  it('harus menerima 5 sampel yang konsisten (semua dekat dengan centroid)', () => {
    const base = new Array(128).fill(0.1);
    const samples = [
      { descriptor: [...base], sample_label: 'lurus' },
      { descriptor: base.map((v, i) => (i === 0 ? v + 0.05 : v)), sample_label: 'kiri' },
      { descriptor: base.map((v, i) => (i === 1 ? v + 0.05 : v)), sample_label: 'kanan' },
      { descriptor: base.map((v, i) => (i === 2 ? v + 0.05 : v)), sample_label: 'atas' },
      { descriptor: base.map((v, i) => (i === 3 ? v + 0.05 : v)), sample_label: 'bawah' },
    ];

    const res = checkInternalConsistency(samples, FACE_CONFIG.ENROLL_MAX_OUTLIER_DIST);
    expect(res.ok).toBe(true);
    expect(res.outlierIndices).toHaveLength(0);
  });

  it('harus mendeteksi outlier jika ada sampel yang menyimpang > ENROLL_MAX_OUTLIER_DIST', () => {
    const base = new Array(128).fill(0.1);
    const samples = [
      { descriptor: [...base], sample_label: 'lurus' },
      { descriptor: [...base], sample_label: 'kiri' },
      { descriptor: [...base], sample_label: 'kanan' },
      { descriptor: [...base], sample_label: 'atas' },
      // Outlier parah (jarak > 0.40)
      { descriptor: base.map((v) => v + 0.20), sample_label: 'bawah' },
    ];

    const res = checkInternalConsistency(samples, FACE_CONFIG.ENROLL_MAX_OUTLIER_DIST);
    expect(res.ok).toBe(false);
    expect(res.outlierIndices).toContain(4);
  });
});
