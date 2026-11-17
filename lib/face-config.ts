/**
 * Konfigurasi Terpusat Face Recognition & Keamanan Identitas MonsClock
 * Semua ambang batas ditaruh di sini agar konsisten antara client dan server,
 * serta dapat di-override lewat Environment Variables bila diperlukan saat kalibrasi lapangan.
 */

export interface FaceConfig {
  // === Kualitas Capture di Tablet ===
  MIN_FACE_PX: number;
  MAX_ABS_YAW: number;
  MAX_ABS_PITCH_DELTA: number;
  MAX_ABS_ROLL_DEG: number;
  BRIGHTNESS_RANGE: [number, number];
  LR_BRIGHTNESS_RATIO: [number, number];
  MAX_CLIPPED_PIXEL_PCT: number;
  MIN_SHARPNESS: number;
  FRAMES_REQUIRED: number;
  FRAME_SPACING_MS: number;
  MAX_FRAME_SPREAD: number;

  // === Kebijakan Keputusan di Server ===
  ACCEPT_MAX_SCORE: number;
  ACCEPT_MIN_MARGIN: number;
  CONFIRM_MAX_SCORE: number;
  CANDIDATE_WINDOW: number;

  // === Pendaftaran Wajah (Enrollment) ===
  ENROLL_SAMPLES: number;
  ENROLL_FRAMES_PER_SAMPLE: number;
  ENROLL_MAX_OUTLIER_DIST: number;
  ENROLL_LOOKALIKE_GUARD: number;
  MAX_SAMPLES_PER_SUBJECT: number;

  // === Verifikasi & Single-Use Token ===
  TTL_ABSEN_SEC: number;
  TTL_TRIP_SEC: number;
  MAX_CONFIRM_ATTEMPTS: number;
  UNDO_WINDOW_SEC: number;
}

export const FACE_CONFIG: FaceConfig = {
  // === Kualitas Capture di Tablet ===
  MIN_FACE_PX: 140, // Lebar wajah minimum dalam piksel video sumber (bukan rasio)
  MAX_ABS_YAW: 0.18, // Toleransi hadap kiri/kanan saat verifikasi (~10 derajat, alami & nyaman)
  MAX_ABS_PITCH_DELTA: 0.18, // Selisih dari pitch frontal hasil kalibrasi (~10 derajat)
  MAX_ABS_ROLL_DEG: 12, // Kemiringan kepala maksimum (derajat)
  BRIGHTNESS_RANGE: [70, 190], // Rata-rata luminance crop wajah (0-255)
  LR_BRIGHTNESS_RATIO: [0.6, 1.6], // Rasio luminance kiri/kanan (deteksi backlight/bayangan)
  MAX_CLIPPED_PIXEL_PCT: 8, // Maksimal % piksel jenuh > 250 (silau)
  MIN_SHARPNESS: 60, // Variance Laplacian minimum pada crop 160x160 grayscale
  FRAMES_REQUIRED: 4, // Jumlah frame lolos kualitas per scan verifikasi
  FRAME_SPACING_MS: 150, // Jeda waktu minimum antar pengambilan frame
  MAX_FRAME_SPREAD: 0.30, // Jarak antar-frame maksimum (konsistensi multi-frame)

  // === Kebijakan Keputusan di Server ===
  ACCEPT_MAX_SCORE: 0.38, // Skor d_top2 maksimum untuk status ACCEPT
  ACCEPT_MIN_MARGIN: 0.10, // Margin minimum (S2 - S1) untuk status ACCEPT
  CONFIRM_MAX_SCORE: 0.46, // Skor d_top2 maksimum untuk status CONFIRM
  CANDIDATE_WINDOW: 0.10, // Kandidat dengan skor <= S1 + window ditawarkan di zona confirm

  // === Pendaftaran Wajah (Enrollment) ===
  ENROLL_SAMPLES: 3, // 3 sampel berkualitas tinggi (Cukup Hadap Kamera, cepat & tidak repot)
  ENROLL_FRAMES_PER_SAMPLE: 2, // Jumlah frame yang dirata-ratakan per sampel
  ENROLL_MAX_OUTLIER_DIST: 0.35, // Jarak maksimum sampel ke centroid dirinya sendiri
  ENROLL_LOOKALIKE_GUARD: 0.50, // Skor ke orang lain di bawah nilai ini akan ditolak/diberi flag mirip
  MAX_SAMPLES_PER_SUBJECT: 12, // Batas maksimum sampel per orang

  // === Verifikasi & Single-Use Token ===
  TTL_ABSEN_SEC: 60, // Masa berlaku token verifikasi absen (1 menit)
  TTL_TRIP_SEC: 900, // Masa berlaku token verifikasi trip (15 menit)
  MAX_CONFIRM_ATTEMPTS: 3, // Maksimal percobaan konfirmasi No ID sebelum terkunci
  UNDO_WINDOW_SEC: 180, // Jendela waktu pembatalan "Bukan saya" (3 menit)
};

/**
 * Mengambil konfigurasi aktif dengan memperhitungkan override dari process.env (sisi server).
 */
export function getActiveFaceConfig(): FaceConfig {
  if (typeof process === 'undefined' || !process.env) {
    return FACE_CONFIG;
  }

  const envFloat = (key: string, def: number): number => {
    const val = process.env[key];
    if (!val) return def;
    const n = parseFloat(val);
    return Number.isFinite(n) ? n : def;
  };

  const envInt = (key: string, def: number): number => {
    const val = process.env[key];
    if (!val) return def;
    const n = parseInt(val, 10);
    return Number.isFinite(n) ? n : def;
  };

  return {
    ...FACE_CONFIG,
    MIN_FACE_PX: envInt('FACE_MIN_FACE_PX', FACE_CONFIG.MIN_FACE_PX),
    MAX_ABS_YAW: envFloat('FACE_MAX_ABS_YAW', FACE_CONFIG.MAX_ABS_YAW),
    MAX_ABS_PITCH_DELTA: envFloat('FACE_MAX_ABS_PITCH_DELTA', FACE_CONFIG.MAX_ABS_PITCH_DELTA),
    MAX_ABS_ROLL_DEG: envFloat('FACE_MAX_ABS_ROLL_DEG', FACE_CONFIG.MAX_ABS_ROLL_DEG),
    MIN_SHARPNESS: envFloat('FACE_MIN_SHARPNESS', FACE_CONFIG.MIN_SHARPNESS),
    FRAMES_REQUIRED: envInt('FACE_FRAMES_REQUIRED', FACE_CONFIG.FRAMES_REQUIRED),
    FRAME_SPACING_MS: envInt('FACE_FRAME_SPACING_MS', FACE_CONFIG.FRAME_SPACING_MS),
    MAX_FRAME_SPREAD: envFloat('FACE_MAX_FRAME_SPREAD', FACE_CONFIG.MAX_FRAME_SPREAD),

    ACCEPT_MAX_SCORE: envFloat('FACE_ACCEPT_MAX_SCORE', FACE_CONFIG.ACCEPT_MAX_SCORE),
    ACCEPT_MIN_MARGIN: envFloat('FACE_ACCEPT_MIN_MARGIN', FACE_CONFIG.ACCEPT_MIN_MARGIN),
    CONFIRM_MAX_SCORE: envFloat('FACE_CONFIRM_MAX_SCORE', FACE_CONFIG.CONFIRM_MAX_SCORE),
    CANDIDATE_WINDOW: envFloat('FACE_CANDIDATE_WINDOW', FACE_CONFIG.CANDIDATE_WINDOW),

    ENROLL_SAMPLES: envInt('FACE_ENROLL_SAMPLES', FACE_CONFIG.ENROLL_SAMPLES),
    ENROLL_FRAMES_PER_SAMPLE: envInt('FACE_ENROLL_FRAMES_PER_SAMPLE', FACE_CONFIG.ENROLL_FRAMES_PER_SAMPLE),
    ENROLL_MAX_OUTLIER_DIST: envFloat('FACE_ENROLL_MAX_OUTLIER_DIST', FACE_CONFIG.ENROLL_MAX_OUTLIER_DIST),
    ENROLL_LOOKALIKE_GUARD: envFloat('FACE_ENROLL_LOOKALIKE_GUARD', FACE_CONFIG.ENROLL_LOOKALIKE_GUARD),
    MAX_SAMPLES_PER_SUBJECT: envInt('FACE_MAX_SAMPLES_PER_SUBJECT', FACE_CONFIG.MAX_SAMPLES_PER_SUBJECT),

    TTL_ABSEN_SEC: envInt('FACE_TTL_ABSEN_SEC', FACE_CONFIG.TTL_ABSEN_SEC),
    TTL_TRIP_SEC: envInt('FACE_TTL_TRIP_SEC', FACE_CONFIG.TTL_TRIP_SEC),
    MAX_CONFIRM_ATTEMPTS: envInt('FACE_MAX_CONFIRM_ATTEMPTS', FACE_CONFIG.MAX_CONFIRM_ATTEMPTS),
    UNDO_WINDOW_SEC: envInt('FACE_UNDO_WINDOW_SEC', FACE_CONFIG.UNDO_WINDOW_SEC),
  };
}
