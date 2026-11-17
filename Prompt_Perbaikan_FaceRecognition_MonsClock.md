# PROMPT ANTIGRAVITY — Perbaikan Akurasi & Keamanan Identitas Face Recognition MonsClock

Kamu adalah senior engineer yang ahli di face recognition dan keamanan aplikasi. Aplikasi **MonsClock** (Next.js + TypeScript + Tailwind + Supabase + Vercel, face-api.js `@vladmandic/face-api` + MediaPipe) sedang tahap testing, dan ditemukan **masalah serius: wajah seseorang dikenali sebagai orang lain** saat absen. Akibatnya absensi tercatat atas nama yang salah. Tugasmu: perbaiki dengan benar, bukan sekadar menurunkan threshold.

Prinsip utama: **lebih baik menolak atau meminta konfirmasi daripada mencatat atas nama orang yang salah.**

Kerjakan bertahap sesuai urutan di bagian 14. Jalankan `npm run build` dan test di akhir tiap fase. Teks UI tetap Bahasa Indonesia. Jangan menyimpan foto wajah (hanya vektor numerik), dan jangan merusak alur yang sudah berjalan (absen masuk/istirahat/pulang, FLM/RPL/CIT, daftar wajah).

---

## 1. TEMUAN ANALISIS (verifikasi dulu di kode, lalu perbaiki)

Sebelum mengubah apa pun, baca ulang file berikut dan **konfirmasi tiap temuan** (sebutkan baris/fungsi yang relevan di ringkasan awalmu). Jika ada temuan yang ternyata tidak benar, laporkan.

**T1. Keputusan identitas dari 1 frame saja** (`FaceScanner.tsx`)
Jika `outcome.distance ≤ 0.34`, scan langsung diterima dari satu frame. Untuk jarak > 0.34, `pendingConfirmRef` menyimpan `count: 1` tetapi nilai `count` tidak pernah dicek: frame berikutnya dengan subjek yang sama langsung diterima. Jadi "konfirmasi 2 frame" praktis hanya jeda satu frame. Satu frame yang buram/miring sudah cukup untuk salah orang.

**T2. Pengecekan "ambigu" terlalu longgar** (`matchDescriptor` di `lib/face.ts`)
Pengecekan ambigu hanya jalan jika `best.minDistance > 0.28` dan margin ke kandidat kedua hanya `0.06`. Kandidat terbaik dipilih dari **jarak minimum ke satu sampel mana pun**, sehingga:
- peluang "kebetulan dekat" naik seiring jumlah sampel per orang (orang yang pernah "Tambah Sampel" jadi lebih mudah menyedot wajah orang lain),
- satu sampel yang kebetulan mirip sudah cukup.

**T3. Wajah kecil/jauh masih diterima** (`analyzeMediaPipeResult` di `lib/mediapipe.ts`)
Syarat ukuran minimum hanya `widthRatio ≥ 0.16` dan `heightRatio ≥ 0.17`. Pada video 480 px, wajah ±77 px sudah lolos, lalu di-upscale ke 224 px. Descriptor dari wajah kecil/buram cenderung "mengumpul" ke area yang sama sehingga jarak antar orang berbeda mengecil. Ini kandidat penyebab utama.

**T4. Filter kualitas terlalu longgar dan diukur di gambar yang salah** (`checkCanvasQuality`)
Brightness minimum hanya 34 dan ketajaman 4.5, dihitung pada canvas 192×256 yang sudah di-downscale (bukan pada crop wajah yang dikirim ke model). Tidak ada deteksi cahaya tidak merata (backlight), over-exposure, atau pose pitch. Pitch tidak dibatasi sama sekali saat scan.

**T5. Pipeline deteksi ganda yang tidak stabil** (`getTargetCanvas` + `extractFaceDescriptor`)
Crop 1.65× dari bounding box MediaPipe → di-resize 224×224 → `TinyFaceDetector` mendeteksi ulang wajah di crop itu → landmark 68 → descriptor. Kotak hasil TinyFaceDetector berbeda-beda antar frame, sehingga alignment descriptor ikut bergoyang. Tidak ada pemeriksaan bahwa hasil deteksi kedua konsisten dengan hasil MediaPipe, dan tidak ada koreksi rotasi kepala (roll).

**T6. Pendaftaran wajah terlalu dangkal** (`FaceEnrollView.tsx`)
Hanya 3 sampel (lurus, kiri, kanan), syarat pose sangat kecil (`yaw ≥ 0.045`, `≤ 0.09`), diambil berurutan dalam ±1 detik pada pencahayaan yang sama. Tiga sampel hampir kembar, variasi pose/cahaya/ekspresi hampir tidak terwakili, jadi template lemah dan mudah bersinggungan dengan orang lain. Tidak ada pengecekan konsistensi antar sampel milik orang yang sama.

**T7. Server memercayai identitas dari browser** (`/api/absen`, `/api/trips/*`)
Browser mengirim `employee_id` + `match_distance` hasil hitungan sendiri, dan server mencatatnya. Siapa pun yang punya sesi kiosk bisa mengirim `employee_id` sembarang, dan server tidak bisa mengaudit mengapa seseorang dianggap cocok. Selain itu `/api/face/templates` mengirim **seluruh vektor wajah** ke tablet (data biometrik tersebar ke perangkat).

**T8. Tidak ada jejak audit kecocokan**
`attendance_events` hanya menyimpan `match_distance`. Tidak ada kandidat kedua, margin, jumlah frame, atau zona keputusan, sehingga kasus salah-orang tidak bisa ditelusuri atau dipelajari.

**T9. Keterbatasan model** (tidak bisa "dipatch", tapi harus diukur)
Model `faceRecognitionNet` bawaan face-api (arsitektur dlib ResNet, era 2017) dikenal kurang tajam membedakan wajah pada kelompok demografis yang kurang terwakili di data latihnya. Karena itu aplikasi tidak boleh mengandalkan satu angka threshold. Perlu data nyata (lihat Fase 7) untuk menilai apakah Fase 1–6 cukup, dan Fase 8 disiapkan sebagai opsi.

---

## 2. PRINSIP DESAIN

1. **Server yang memutuskan identitas.** Browser hanya mengirim descriptor, bukan klaim "ini si A".
2. **Keputusan 3 zona:** `ACCEPT` (yakin, langsung catat), `CONFIRM` (ragu, minta verifikasi tambahan), `REJECT` (tolak).
3. **Multi-frame:** identitas diputuskan dari beberapa frame yang konsisten, bukan satu frame.
4. **Kualitas dulu:** gambar buruk ditolak di tablet sebelum sampai ke model.
5. **Setiap keputusan terekam** (kandidat 1 & 2, jarak, margin, jumlah frame, zona) agar bisa diaudit.
6. **Salah orang bisa dibatalkan** dengan cepat oleh karyawan yang bersangkutan.
7. **Angka threshold bukan keyakinan, hanya titik awal.** Semua angka ada di satu file konfigurasi dan dikalibrasi memakai data nyata dari halaman audit.

---

## 3. FASE 1 — DATABASE & KONFIGURASI

Buat migration baru `supabase/migrations/0002_face_security.sql` (jangan ubah `0001`).

```sql
create extension if not exists vector;

-- Kolom tambahan pada template wajah
alter table public.face_templates
  add column if not exists embedding vector(128),
  add column if not exists pipeline_version smallint not null default 2,
  add column if not exists quality jsonb;

update public.face_templates
  set embedding = descriptor::vector(128)
  where embedding is null;

-- Verifikasi identitas sekali pakai (server-side)
create table if not exists public.face_verifications (
  id uuid primary key default gen_random_uuid(),
  kiosk_user_id uuid not null,
  purpose text not null check (purpose in ('absen','trip_staff1','trip_staff2','trip_escort')),
  subject_type text not null check (subject_type in ('employee','escort')),
  subject_id uuid,                       -- terisi setelah ACCEPT atau konfirmasi
  zone text not null check (zone in ('accept','confirm','reject')),
  score numeric,                         -- skor kandidat terbaik
  second_subject_id uuid,
  second_score numeric,
  margin numeric,
  frames_used int,
  candidates jsonb,                      -- maks 3 kandidat (id saja) untuk zona confirm
  confirm_attempts int not null default 0,
  confirmed_method text,                 -- 'no_id_last4' | 'rfid' | null
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  consumed_at timestamptz
);
create index if not exists idx_face_verifications_created on public.face_verifications(created_at desc);

-- Jejak audit pada event absen
alter table public.attendance_events
  add column if not exists verification_id uuid references public.face_verifications(id),
  add column if not exists second_subject_id uuid,
  add column if not exists second_distance double precision,
  add column if not exists margin double precision,
  add column if not exists decision_zone text,
  add column if not exists frames_used int,
  add column if not exists before_state jsonb,   -- snapshot baris attendance sebelum event (untuk pembatalan)
  add column if not exists voided_at timestamptz,
  add column if not exists void_reason text;

-- Pasangan wajah mirip yang ditandai admin (selalu masuk zona confirm)
create table if not exists public.face_lookalike_flags (
  id uuid primary key default gen_random_uuid(),
  subject_type text not null,
  subject_a uuid not null,
  subject_b uuid not null,
  created_by uuid,
  created_at timestamptz not null default now(),
  unique (subject_a, subject_b)
);

-- Pencocokan per orang (hanya service_role)
create or replace function public.match_faces(q vector(128), p_subject_type text)
returns table (subject_id uuid, n_samples int, d_min float8, d_top2 float8, d_mean float8)
language sql stable security definer set search_path = public as $$
  with d as (
    select coalesce(employee_id, escort_id) as sid, (embedding <-> q)::float8 as dist
    from public.face_templates
    where subject_type = p_subject_type and embedding is not null
  ), r as (
    select sid, dist, row_number() over (partition by sid order by dist) as rn from d
  )
  select sid, count(*)::int, min(dist), avg(dist) filter (where rn <= 2), avg(dist)
  from r group by sid order by 4 asc limit 5;
$$;
revoke all on function public.match_faces(vector, text) from public, anon, authenticated;
grant execute on function public.match_faces(vector, text) to service_role;
```

Aktifkan RLS pada tabel baru (akses hanya lewat service role dari Route Handler, admin boleh `select`).

**Konfigurasi terpusat** `lib/face-config.ts` (dipakai server dan client, boleh di-override env `FACE_*` di sisi server). Semua angka di bawah adalah **titik awal**, bukan nilai final:

```ts
export const FACE_CONFIG = {
  // Kualitas capture (di tablet)
  MIN_FACE_PX: 140,            // lebar wajah minimum pada piksel video sumber
  MAX_ABS_YAW: 0.10,
  MAX_ABS_PITCH_DELTA: 0.10,   // selisih dari pitch frontal hasil kalibrasi
  MAX_ABS_ROLL_DEG: 12,
  BRIGHTNESS_RANGE: [70, 190], // rata-rata luminance crop wajah
  LR_BRIGHTNESS_RATIO: [0.6, 1.6], // cahaya kiri/kanan wajah (deteksi backlight/samping)
  MAX_CLIPPED_PIXEL_PCT: 8,
  MIN_SHARPNESS: 60,           // variance Laplacian pada crop 160x160 grayscale
  FRAMES_REQUIRED: 4,          // frame lolos kualitas per scan
  FRAME_SPACING_MS: 150,
  MAX_FRAME_SPREAD: 0.30,      // jarak antar-frame maksimum (konsistensi)
  // Keputusan (di server)
  ACCEPT_MAX_SCORE: 0.38,
  ACCEPT_MIN_MARGIN: 0.10,
  CONFIRM_MAX_SCORE: 0.46,
  CANDIDATE_WINDOW: 0.10,      // kandidat dengan skor <= terbaik + window ikut ditawarkan
  // Pendaftaran
  ENROLL_SAMPLES: 5,
  ENROLL_FRAMES_PER_SAMPLE: 3,
  ENROLL_MAX_OUTLIER_DIST: 0.35, // jarak sampel ke centroid orang itu sendiri
  ENROLL_LOOKALIKE_GUARD: 0.50,  // skor ke orang lain di bawah ini → tolak/flag
  MAX_SAMPLES_PER_SUBJECT: 12,
  // Verifikasi
  TTL_ABSEN_SEC: 60,
  TTL_TRIP_SEC: 900,
  MAX_CONFIRM_ATTEMPTS: 3,
  UNDO_WINDOW_SEC: 180,
} as const;
```

**Skor** per kandidat = `d_top2` (rata-rata jarak ke **2 sampel terdekat**), bukan jarak minimum tunggal. **Margin** = skor kandidat kedua − skor kandidat pertama. Pemakaian dua sampel terdekat mengurangi keuntungan orang yang punya banyak sampel (T2).

---

## 4. FASE 2 — VERIFIKASI IDENTITAS DI SERVER

Tujuan: identitas **hanya** boleh berasal dari verifikasi server yang sah. Hapus kepercayaan pada `employee_id` dari browser (T7).

### 4.1 `POST /api/face/verify`
Role: `absen`, `admin`, `superadmin`.
Request: `{ purpose, subject_type, descriptors: number[][] }` (4–6 descriptor 128-dim dari frame berbeda).
Langkah di server:
1. Validasi dengan zod (panjang 128, angka finite, jumlah frame ≥ `FRAMES_REQUIRED`).
2. Cek konsistensi frame: jarak antar-descriptor terjauh ≤ `MAX_FRAME_SPREAD`. Buang outlier (>0.25 dari rata-rata) tapi sisakan minimal 3 frame; jika kurang → balas `{ status: 'retry', reason: 'frames_inconsistent' }`.
3. Rata-ratakan descriptor yang lolos → `q`. Panggil RPC `match_faces(q, subject_type)` (service role).
4. Terapkan kebijakan keputusan (bagian 6) → zona `accept` / `confirm` / `reject`.
5. Simpan baris `face_verifications` lengkap (skor, kandidat kedua, margin, `frames_used`, `expires_at` sesuai purpose).
6. Balas **tanpa vektor apa pun**:
   - `accept` → `{ status:'accepted', verification_id, subject:{id,name,subtitle}, score, margin }`
   - `confirm` → `{ status:'confirm', verification_id, candidates:[{id,name,subtitle}] }` (maks 3, urutan acak agar tidak membocorkan peringkat)
   - `reject` → `{ status:'rejected', reason:'not_found' }`
7. Rate limit per kiosk (misal maks 30 verifikasi per menit).

### 4.2 `POST /api/face/confirm` (khusus zona confirm)
Request: `{ verification_id, chosen_subject_id, factor: string }`.
- Pastikan verifikasi milik kiosk yang sama, belum kedaluwarsa, zona `confirm`, `confirm_attempts < MAX_CONFIRM_ATTEMPTS`, dan `chosen_subject_id` ada di `candidates`.
- Untuk karyawan: `factor` = **4 karakter terakhir `employee_no`** (case-insensitive) atau nomor RFID penuh jika dibaca lewat reader keyboard-emulation. Bandingkan di server.
- Untuk pengawal (tidak punya No ID): cukup `chosen_subject_id` dari kandidat.
- Salah → `confirm_attempts + 1`; setelah 3 kali gagal verifikasi dikunci (`zone` menjadi `reject`) dan dicatat di `audit_logs`.
- Berhasil → set `subject_id`, `confirmed_method`, balas `{ status:'accepted', verification_id, subject }`.

### 4.3 Endpoint yang mengonsumsi identitas
Ubah semua endpoint berikut agar menerima **`verification_id`**, bukan `employee_id`/`escort_id` mentah:
- `/api/absen` (masuk/istirahat/pulang)
- `/api/trips/context`, `/api/trips/depart`, `/api/trips/return` (staff 1, staff 2, pengawal: `verification_id` masing-masing)

Aturan konsumsi (satu fungsi `consumeVerification()` di `lib/face-verify.ts`):
- Milik kiosk user yang sama, `zone='accept'` atau sudah dikonfirmasi, belum `consumed_at`, belum lewat `expires_at`.
- Untuk aksi tulis (`/api/absen`, `depart`, `return`): set `consumed_at` secara atomik (`update ... where consumed_at is null returning`), sehingga tidak bisa dipakai ulang. `trips/context` hanya membaca (tidak mengonsumsi).
- Tulis ke `attendance_events`: `verification_id`, `match_distance` (= skor), `second_subject_id`, `second_distance`, `margin`, `decision_zone`, `frames_used`, `before_state` (snapshot baris `attendance` sebelum diubah).
- `match_distance`/`employee_id` dari body request **diabaikan**.

### 4.4 Berhenti mengirim vektor ke tablet
`/api/face/templates`:
- Untuk role `absen`: hanya kembalikan daftar subjek (`id, name, subtitle, code, sample_count`), **tanpa `descriptor`**. Halaman Daftar Wajah di tablet hanya butuh daftar ini.
- Hapus `face-cache.ts` dan semua pemakaian `getCachedFaceTemplates`/`matchDescriptor` di sisi client (`FaceScanner`, `FaceEnrollView`, `AbsenPreloader`). Preloader cukup memanaskan model + landmarker.
- Role admin: vektor juga tidak perlu dikirim; halaman audit memakai RPC di server.

---

## 5. FASE 3 — PIPELINE CAPTURE DI TABLET

Perbaiki `lib/mediapipe.ts`, `lib/face.ts`, dan loop di `FaceScanner.tsx`.

### 5.1 Kamera dan pose
- Minta resolusi lebih tinggi: `width ideal 720, height ideal 960` (fallback otomatis ke yang tersedia). MediaPipe tetap berjalan di canvas kecil (192×256) agar ringan; **crop untuk model dipotong dari frame video resolusi penuh**.
- Aktifkan `outputFacialTransformationMatrixes: true` di FaceLandmarker untuk mendapat **yaw, pitch, roll** yang andal (ganti hitungan yaw/pitch manual). Kalibrasi nilai pitch frontal per sesi.
- Gate ukuran memakai **piksel di video sumber**: lebar wajah ≥ `MIN_FACE_PX`. Hapus ambang `widthRatio ≥ 0.16` lama (T3). Pesan: "Mendekat sedikit ke kamera".
- Gate pose: `|yaw| ≤ MAX_ABS_YAW`, `|pitch − pitchFrontal| ≤ MAX_ABS_PITCH_DELTA`, `|roll| ≤ MAX_ABS_ROLL_DEG`.

### 5.2 Crop yang stabil (perbaikan T5)
- Hitung bounding box dari landmark MediaPipe (stabil), lalu **koreksi roll** (rotasi canvas agar garis mata horizontal).
- Crop persegi sekitar **1.4×** sisi terpanjang box (jangan 1.65×), diambil dari video resolusi penuh, ke canvas **320×320**.
- Jalankan `TinyFaceDetector` dengan `inputSize: 320`, `scoreThreshold: 0.5` pada crop itu, lalu `withFaceLandmarks().withFaceDescriptor()`.
- **Sanity check wajib:** pusat dan ukuran box hasil TinyFaceDetector harus konsisten dengan box MediaPipe (misal pusat bergeser < 12% sisi crop dan rasio ukuran 0.7–1.3). Jika tidak → buang frame.
- Jadikan faktor crop dan `inputSize` sebagai konstanta mudah diubah, karena nilai terbaik perlu dievaluasi memakai halaman audit (Fase 7).

### 5.3 Gate kualitas pada crop wajah (perbaikan T4)
Hitung pada crop wajah hasil langkah 5.2 (dikecilkan ke 160×160 grayscale), bukan pada canvas MediaPipe:
- rata-rata luminance dalam `BRIGHTNESS_RANGE`,
- rasio luminance separuh kiri : kanan dalam `LR_BRIGHTNESS_RATIO` (menolak backlight / cahaya dari samping),
- persentase piksel jenuh (>250) ≤ `MAX_CLIPPED_PIXEL_PCT`,
- ketajaman (variance Laplacian) ≥ `MIN_SHARPNESS`.
Pesan spesifik per kegagalan (gelap, silau, cahaya dari samping, buram).

### 5.4 Multi-frame (perbaikan T1)
- Setelah wajah lolos semua gate **dan stabil ≥ 600 ms**, kumpulkan `FRAMES_REQUIRED` frame lolos kualitas dengan jeda ≥ `FRAME_SPACING_MS`.
- Ekstrak descriptor tiap frame berurutan (jangan paralel, tablet RAM 3GB), lalu kirim semuanya **sekaligus** ke `/api/face/verify`.
- Satu scan = satu panggilan verify. Hapus logika `pendingConfirmRef` lama.
- Jika server membalas `retry`/`rejected`, tampilkan pesan, beri jeda ±900 ms, ulangi dari awal (kumpulkan frame baru).
- Liveness (kedip/gerak) tetap ada, tetapi tidak boleh dianggap bukti identitas.

### 5.5 Mode debug (hanya admin)
Overlay kecil opsional (aktif lewat `?debug=1` + PIN admin) yang menampilkan metrik kualitas (brightness, L/R, sharpness, ukuran wajah px, yaw/pitch/roll), skor, margin, dan zona terakhir. Gunanya untuk kalibrasi lapangan. Tidak aktif untuk karyawan.

---

## 6. FASE 4 — KEBIJAKAN KEPUTUSAN (server, `lib/face-decision.ts`)

Fungsi murni dan mudah diuji: `decide(candidates, flaggedPairs, config) → {zone, best, second, margin, candidates}`.

Misalkan `S1` = skor kandidat terbaik, `S2` = skor kandidat kedua, `margin = S2 − S1`.

1. **ACCEPT** jika: `S1 ≤ ACCEPT_MAX_SCORE` **dan** `margin ≥ ACCEPT_MIN_MARGIN` **dan** pasangan (kandidat 1, kandidat 2) tidak ada di `face_lookalike_flags`.
2. **CONFIRM** jika bukan ACCEPT tetapi `S1 ≤ CONFIRM_MAX_SCORE`. Kandidat yang ditawarkan = semua dengan skor ≤ `S1 + CANDIDATE_WINDOW`, maksimal 3.
3. **REJECT** jika `S1 > CONFIRM_MAX_SCORE` atau tidak ada kandidat.
4. Jika hanya ada 1 orang terdaftar (kandidat kedua tidak ada), anggap `S2 = +∞` tetapi tetap wajib `S1 ≤ ACCEPT_MAX_SCORE` untuk ACCEPT.

Tulis **unit test (vitest)** untuk `decide()` dengan vektor sintetis:
- cocok jelas → ACCEPT;
- dua orang mirip (margin kecil) → CONFIRM dengan 2 kandidat;
- orang tak dikenal → REJECT;
- orang yang punya banyak sampel tidak otomatis menang atas orang bersampel sedikit (verifikasi efek `d_top2`);
- pasangan di `face_lookalike_flags` tidak pernah ACCEPT;
- frame tidak konsisten → `retry`.

---

## 7. FASE 5 — PENDAFTARAN WAJAH v2

Perbaiki `FaceEnrollView.tsx` dan `/api/face/enroll` (T6).

**Di tablet / webcam admin:**
- `ENROLL_SAMPLES = 5` langkah pose: **lurus, sedikit kiri, sedikit kanan, sedikit mendongak, sedikit menunduk**. Pose divalidasi memakai yaw/pitch dari transformation matrix dengan rentang sudut yang jelas (± ±10–20°, bukan 0.045), bukan angka kecil seperti sebelumnya.
- Tiap sampel = **rata-rata `ENROLL_FRAMES_PER_SAMPLE` frame** berurutan yang lolos semua gate kualitas bagian 5.
- Tampilkan petunjuk: lepas topi, kacamata hitam, dan masker; wajah merata terkena cahaya.
- Setelah semua selesai, cek konsistensi internal: jarak tiap sampel ke centroid sampelnya sendiri ≤ `ENROLL_MAX_OUTLIER_DIST`; sampel di luar batas diulang.
- Simpan `quality` (JSON metrik kualitas tiap sampel) dan `pipeline_version = 2`.
- Tombol "Ambil Manual" tetap boleh, tetapi tetap harus lolos gate kualitas yang sama (jangan dilonggarkan).

**Di server (`/api/face/enroll`):**
1. Hitung `embedding` dari `descriptor` dan simpan di kedua kolom.
2. **Penjaga kemiripan silang** (gantikan angka 0.46 lama): untuk tiap sampel, panggil `match_faces` terhadap orang **lain** pada `subject_type` yang sama. Jika skor orang lain `< ENROLL_LOOKALIKE_GUARD`, tolak dengan pesan menyebut nama yang mirip dan sarankan: ulangi di cahaya lebih baik, atau (khusus admin) **tandai sebagai "wajah mirip"** agar pasangan itu selalu masuk zona konfirmasi (`face_lookalike_flags`).
3. Batasi `MAX_SAMPLES_PER_SUBJECT`: jika "Tambah Sampel" melewati batas, hapus sampel tertua atau berkualitas terendah.
4. Catat ke `audit_logs`.

**Karena masih tahap testing:** sediakan tombol admin **"Reset semua template wajah"** (butuh konfirmasi ketik `RESET`) lalu semua karyawan dan pengawal mendaftar ulang dengan pipeline baru. Tidak perlu kompatibilitas dengan template lama. **Jangan menghapus data apa pun tanpa konfirmasi eksplisit dari pengguna.**

---

## 8. FASE 6 — UI KONFIRMASI & PEMBATALAN

### 8.1 Hasil scan di `FaceScanner`
Ubah `onResult` agar mengembalikan objek verifikasi: `{ verification_id, subject_type, subject_id, name, subtitle }` (tanpa `distance`).
- Status `accepted` → langsung panggil `onResult`.
- Status `confirm` → tampilkan **sheet konfirmasi** (komponen baru `ConfirmIdentitySheet`):
  - judul "Pilih nama Anda",
  - tombol besar berisi 2–3 nama kandidat (urutan acak),
  - setelah memilih, input **4 karakter terakhir No ID** (keypad besar, ramah tablet); untuk pengawal tidak ada input tambahan,
  - tombol "Bukan salah satu ini / Scan ulang",
  - pesan error jelas dan hitungan sisa percobaan; setelah terkunci kembali ke scan.
- Status `rejected` → "Wajah tidak dikenali, coba lagi" dan hitung kegagalan. Setelah 3 kali tampilkan petunjuk cahaya dan tautan Daftar Wajah (perilaku lama dipertahankan).

### 8.2 Pembatalan "Bukan saya"
Pada `AttendanceSuccessModal`, tambah tombol sekunder **"Bukan saya? Batalkan"**.
- `POST /api/absen/void` `{ event_id, reason }`: hanya untuk kiosk yang sama, event masih dalam `UNDO_WINDOW_SEC`, dan merupakan event terbaru karyawan itu. Server mengembalikan baris `attendance` ke `before_state`, mengisi `voided_at` dan `void_reason`, dan menulis `audit_logs`.
- Setelah dibatalkan, tampilkan pesan "Absen dibatalkan. Silakan scan ulang atau hubungi admin" dan beri tahu admin lewat daftar review (Fase 7).
- Waktu auto-close pop-up diperpanjang menjadi ±8 detik agar sempat dibaca.
- Untuk FLM/RPL/CIT: staff 2 dan pengawal sudah punya tombol hapus/ganti; pastikan konfirmasi zona `confirm` juga berlaku di sana.

---

## 9. FASE 7 — ADMIN: AUDIT KEMIRIPAN & REVIEW

### 9.1 `/admin/wajah/audit` ("Audit Kemiripan Wajah")
Tombol **"Jalankan Audit"** (proses server, tampilkan loading):
- **Per orang:** jumlah sampel, sebaran internal (jarak sampel terjauh sesama orang itu), nama + skor orang terdekat lainnya, status: `Aman`, `Rawan` (skor orang terdekat < `ENROLL_LOOKALIKE_GUARD`), `Perlu daftar ulang` (sampel < 3 atau sebaran internal tinggi).
- **Daftar pasangan paling mirip** (top 20) dengan skornya, plus tombol "Tandai sebagai wajah mirip" / "Hapus tanda".
- **Ringkasan global:** jarak terkecil antar dua orang berbeda, distribusi jarak antar-orang (histogram sederhana), dan peringatan jika `ACCEPT_MAX_SCORE` terlalu dekat dengan jarak antar-orang terkecil (misal selisih < 0.08), dengan saran angka baru.
- Hitungan lewat SQL/RPC di server, tanpa mengirim vektor ke browser.

### 9.2 `/admin/wajah/review` ("Review Absen")
Tabel `attendance_events` (+ trips jika memungkinkan) dengan filter: zona `confirm`, margin rendah (< `ACCEPT_MIN_MARGIN`), dan event yang `voided`. Kolom: waktu, nama, kandidat kedua, skor, margin, zona, metode konfirmasi, status. Aksi admin: "Valid" atau "Salah orang → koreksi ke…" (memakai alur koreksi data absen yang sudah ada, wajib alasan, tercatat di `audit_logs`). Tambahkan kartu ringkasan di beranda admin: jumlah event zona confirm / dibatalkan 7 hari terakhir.

---

## 10. FASE 8 (OPSIONAL) — MODEL EMBEDDING YANG LEBIH KUAT

Kerjakan **hanya jika** setelah Fase 1–7 halaman audit masih menunjukkan banyak pasangan rawan atau terlalu sering zona confirm.
- Buat antarmuka `FaceEmbedder { dim, extract(canvas) }` sehingga face-api dan model lain bisa ditukar tanpa mengubah alur.
- Evaluasi model embedding modern (keluarga ArcFace/MobileFaceNet) via `onnxruntime-web` (WASM) yang cukup ringan untuk tablet. **Periksa lisensi bobot model** sebelum dipakai, karena sebagian bobot pretrained populer berlisensi non-komersial. Jika tidak memenuhi, laporkan ke pengguna dan berhenti di sini.
- Dimensi vektor berbeda berarti kolom `embedding` baru, `pipeline_version = 3`, dan semua orang harus daftar ulang. Threshold harus dikalibrasi ulang karena skala jarak berbeda (mis. cosine).
- Jangan ganti engine tanpa persetujuan pengguna, cukup siapkan antarmuka dan proposal berisi hasil benchmark pada data nyata.

---

## 11. PENGUJIAN

**Otomatis:**
- Unit test `decide()` (bagian 6), fungsi kualitas gambar (gambar sintetis gelap/buram/silau/berat sebelah), dan `consumeVerification()` (kedaluwarsa, sekali pakai, kiosk berbeda, kunci setelah 3 salah).
- Test API: `/api/absen` menolak `employee_id` mentah; menolak `verification_id` yang sudah dipakai atau kedaluwarsa.

**Manual (sertakan skrip uji di README):**
1. Reset template, daftarkan ulang minimal 10 orang, termasuk dua orang yang sebelumnya tertukar.
2. Jalankan Audit Kemiripan dan catat pasangan rawan.
3. Uji tiap orang scan 5× pada kondisi: terang normal, agak gelap, cahaya dari samping, jarak jauh, memakai topi. Catat zona yang muncul.
4. Uji dua orang yang mirip bergantian: harapannya **tidak ada ACCEPT atas nama yang salah**, melainkan CONFIRM atau REJECT.
5. Uji "Bukan saya? Batalkan" dan pastikan data absen kembali ke kondisi sebelumnya.

---

## 12. KRITERIA SELESAI

1. Tidak ada endpoint yang menerima `employee_id`/`escort_id` dari browser sebagai bukti identitas; semuanya memakai `verification_id` sekali pakai.
2. Tablet tidak lagi mengunduh vektor wajah.
3. Satu scan memakai ≥ 4 frame yang lolos kualitas; wajah kecil, buram, gelap, silau, atau miring ditolak sebelum dikirim.
4. Keputusan 3 zona berjalan; zona confirm meminta pilihan nama + 4 karakter terakhir No ID dan terkunci setelah 3 kali salah.
5. Pendaftaran wajah memakai 5 pose yang jelas, tiap sampel rata-rata beberapa frame, dengan penjaga kemiripan silang dan penanda "wajah mirip".
6. `attendance_events` menyimpan kandidat kedua, margin, zona, jumlah frame, dan `before_state`; pembatalan "Bukan saya" berfungsi.
7. Halaman audit dan review berjalan; unit test hijau; `npm run build` sukses tanpa error TypeScript/ESLint.
8. Kecepatan scan di tablet tetap wajar (target scan sukses ≤ ±3 detik setelah wajah stabil) dan preview kamera tetap mulus.

---

## 13. YANG TIDAK BOLEH DILAKUKAN

- Jangan menyelesaikan masalah hanya dengan menurunkan threshold lalu menganggap selesai.
- Jangan menyimpan foto wajah di database atau storage, dan jangan mengirim vektor wajah ke browser.
- Jangan membiarkan identitas ditentukan oleh nilai yang dikirim client.
- Jangan menghapus data (template, absen, trip) tanpa konfirmasi eksplisit dari pengguna.
- Jangan memakai jam perangkat tablet untuk waktu absen (tetap waktu server).
- Jangan menaruh `SUPABASE_SERVICE_ROLE_KEY` atau rahasia lain di kode client.

---

## 14. URUTAN PENGERJAAN

0. **Ringkasan awal:** konfirmasi temuan T1–T9 dengan merujuk kode, dan laporkan jika ada yang tidak sesuai.
1. **Fase 1:** migration 0002, `face-config.ts`.
2. **Fase 2:** `/api/face/verify`, `/api/face/confirm`, `consumeVerification`, ubah `/api/absen` dan `/api/trips/*`, hapus pengiriman vektor ke tablet.
3. **Fase 4:** `decide()` + unit test (dikerjakan sebelum Fase 3 agar bisa diuji mandiri).
4. **Fase 3:** pipeline capture, gate kualitas, multi-frame, mode debug.
5. **Fase 5:** pendaftaran wajah v2 + reset template (dengan konfirmasi).
6. **Fase 6:** `ConfirmIdentitySheet` + pembatalan "Bukan saya".
7. **Fase 7:** halaman audit dan review.
8. **Pengujian + README**, lalu laporkan hasil dan angka threshold yang direkomendasikan berdasarkan data audit.
9. **Fase 8:** hanya sebagai proposal jika data audit menunjukkan model masih kurang.

Mulai dari langkah 0, lalu setelah tiap fase selesai ringkas apa yang diubah dan apa yang perlu saya uji di tablet.
