# MonsClock — Sistem Absensi Wajah Pos Security

MonsClock adalah aplikasi web berbasis **Next.js (App Router) + TypeScript + Tailwind CSS + Supabase** untuk pencatatan absensi karyawan dan mutasi operasional pos security menggunakan pengenalan wajah (`@vladmandic/face-api`) dan liveness detection (`@mediapipe/tasks-vision`).

---

## 1. Fitur Utama

### Dashboard Kiosk Tablet (`/absen`) — Role `absen`
- Tampilan landscape dengan 6 kartu besar: **MASUK**, **ISTIRAHAT**, **PULANG**, **FLM**, **RPL**, dan **CIT**.
- Pengenalan wajah real-time dengan gerbang kualitas MediaPipe (posisi oval, pencahayaan, ketajaman, dan liveness ringan).
- Jam & tanggal real-time **WIB (Asia/Jakarta)**, seluruh pencatatan waktu menggunakan **jam server (`now()`)**.
- Alur **FLM / RPL / CIT** otomatis mendeteksi mode **KELUAR** atau **KEMBALI** setelah scan wajah pertama, lengkap dengan perhitungan otomatis **Durasi (`HH-MM`)** dan **Total KM**.
- Pendaftaran wajah di tablet (`/absen/daftar-wajah`) dilindungi **PIN Admin** (`FACE_ENROLL_PIN`) dengan panduan 5 sampel (Lurus, Kiri, Kanan, Atas, Bawah).

### Dashboard Admin PC (`/admin`) — Role `admin` & `superadmin`
- **Ringkasan**: Statistik harian absensi, trip yang belum kembali, tamu hari ini, dan unit di bengkel.
- **Data Master**: CRUD + Import Excel (trim & deduplikasi otomatis) + Export Excel untuk **Karyawan**, **Pengawal**, **Area**, **Nopol**, dan **Bengkel**.
- **Mutasi Admin**: Pencatatan **Mutasi Tamu**, **Mutasi Bengkel** (perhitungan otomatis Total KM & Lama Pengerjaan Hari + aksi *Lengkapi Data Kembali*), dan **Mutasi Barang**.
- **Laporan & Audit**: Laporan **Mutasi Karyawan**, **Mutasi FLM**, **Mutasi RPL**, **Mutasi CIT** dengan filter tanggal/karyawan/nopol, Export Excel sesuai format sheet, serta fitur koreksi admin wajib alasan yang tercatat di `audit_logs`.
- **Kelola Wajah** (`/admin/wajah`): Daftarkan atau tambah sampel wajah langsung lewat webcam PC maupun hapus template.
- **Manajemen User** (`/admin/users`, khusus `superadmin`): Tambah user `admin` atau `absen`, ubah role, aktif/nonaktifkan akun, dan reset password.

---

## 2. Persiapan Project Supabase

1. Masuk ke [Supabase Dashboard](https://supabase.com/dashboard) dan buat **New Project** (pilih region terdekat, misalnya Singapore `ap-southeast-1`).
2. Setelah project aktif, buka menu **SQL Editor** → **New Query**.
3. Salin seluruh isi file `supabase/migrations/0001_initial_schema.sql`, lalu klik **Run** untuk membuat semua tabel, index, view (`v_mutasi_flm`, `v_mutasi_rpl`, `v_mutasi_cit`), serta kebijakan **Row Level Security (RLS)**.
4. Buka **Project Settings → API** dan catat:
   - `Project URL` (`NEXT_PUBLIC_SUPABASE_URL`)
   - `anon public key` (`NEXT_PUBLIC_SUPABASE_ANON_KEY`)
   - `service_role secret key` (`SUPABASE_SERVICE_ROLE_KEY`) — **jangan pernah dibagikan atau ditaruh di kode client**.

---

## 3. Konfigurasi Environment Variables

Salin `.env.example` menjadi `.env.local` untuk pengembangan lokal:

```bash
cp .env.example .env.local
```

Isi seluruh variabel pada `.env.local`:

```env
NEXT_PUBLIC_SUPABASE_URL=https://xxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGci...
SUPABASE_SERVICE_ROLE_KEY=eyJhbGci...
NEXT_PUBLIC_FACE_THRESHOLD=0.5
FACE_ENROLL_PIN=123456
SEED_SUPERADMIN_EMAIL=superadmin@perusahaan.com
SEED_SUPERADMIN_PASSWORD=PasswordKuat123!
```

---

## 4. Instalasi, Seed Superadmin & Seed Data Master

1. Install dependensi:
   ```bash
   npm install
   ```
2. Seed akun **Superadmin** awal:
   ```bash
   npm run seed:superadmin
   ```
3. Seed 5 data master dari file `Master Data Absen Security.xlsx`:
   ```bash
   npm run seed:master
   ```
   *(Script otomatis membersihkan spasi berlebih, menormalisasi format nopol menjadi uppercase, menghapus data duplikat, dan aman dijalankan ulang dengan mode upsert.)*
4. Jalankan mode pengembangan atau uji build:
   ```bash
   npm run dev
   # atau
   npm run build
   ```

---

## 5. Deploy ke Vercel

1. Push repository project ke GitHub / GitLab / Bitbucket.
2. Masuk ke [Vercel](https://vercel.com), klik **Add New Project**, lalu pilih repository `monsclock`.
3. Pada bagian **Environment Variables**, masukkan semua variabel berikut (untuk Production, Preview, dan Development):
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `NEXT_PUBLIC_FACE_THRESHOLD` (nilai awal `0.5`)
   - `FACE_ENROLL_PIN` (PIN rahasia untuk pendaftaran wajah di tablet)
4. Klik **Deploy**. Vercel otomatis menyediakan **HTTPS**, yang wajib dibutuhkan agar browser mengizinkan akses kamera depan tablet/PC.
5. Setelah deploy selesai, login menggunakan akun **Superadmin**, lalu buka menu **Manajemen User** untuk membuat:
   - Akun `admin` bagi staf/koordinator pos.
   - Akun `absen` untuk perangkat tablet pos security (misalnya `tablet-pos1@perusahaan.com`).

---

## 6. Panduan Setup Tablet Pos Security (Mode Kiosk)

1. Gunakan tablet Android/iPad dengan browser **Google Chrome** terbaru dan pastikan tanggal/waktu sistem sinkron otomatis.
2. Buka URL aplikasi Vercel (HTTPS) di Chrome, lalu **login menggunakan akun ber-role `absen`**. Sesi dibuat persisten agar tablet tidak perlu login ulang setiap hari.
3. Saat pertama kali membuka menu absen atau daftar wajah, klik **Izinkan (Allow)** pada prompt akses kamera.
4. Aktifkan mode aplikasi layar penuh:
   - Ketuk menu **⋮** di pojok kanan atas Chrome → pilih **Add to Home Screen** (*Tambahkan ke Layar Utama*) → **Install / Tambah**.
   - Buka MonsClock dari ikon shortcut di layar utama agar tampil bersih tanpa address bar browser.
5. Atur perangkat tablet untuk standby di pos security:
   - Setel orientasi layar ke **Portrait** (kunci rotasi ke portrait agar pandangan wajah tegak dan frame seimbang).
   - Nonaktifkan auto-lock / ubah **Screen Timeout** ke maksimal atau gunakan mode **Always On / Kiosk** selama tersambung daya.
   - Pastikan pencahayaan di area pos security cukup terang dan tidak membelakangi lampu agar deteksi wajah cepat dan akurat.

---

## 7. Prosedur Pengujian Manual & Verifikasi Keamanan Wajah (Testing Script)

Untuk menguji dan memastikan masalah salah kenali orang sudah terselesaikan sepenuhnya:

### Langkah 1: Eksekusi Migrasi Database
Buka **Supabase Dashboard** -> **SQL Editor**, salin dan jalankan isi file `supabase/migrations/0004_face_security.sql`.
Migration ini mengaktifkan ekstensi `vector`, tabel `face_verifications`, kolom audit `attendance_events`, tabel `face_lookalike_flags`, dan RPC `match_faces`.

### Langkah 2: Reset Template Lama
1. Login sebagai **Admin** di `/admin/wajah`.
2. Klik tombol merah **"Reset Semua Template Wajah"**, ketik `RESET` untuk konfirmasi. Seluruh template biometrik versi lama akan dibersihkan.

### Langkah 3: Pendaftaran Wajah v2 (5 Pose)
1. Daftarkan minimal 10 orang karyawan/pengawal (termasuk 2 orang yang sebelumnya pernah tertukar namanya).
2. Ikuti 5 tahapan pose:
   - Pose 1: **Lurus** (frontal)
   - Pose 2: **Sedikit Kiri** (~15°)
   - Pose 3: **Sedikit Kanan** (~15°)
   - Pose 4: **Mendongak** (sedikit ke atas)
   - Pose 5: **Menunduk** (sedikit ke bawah)
3. Sistem otomatis merekam rata-rata 3 frame lolos kualitas per pose dan memverifikasi konsistensi internal sebelum disimpan ke server.

### Langkah 4: Jalankan Audit Kemiripan
1. Buka menu **Audit Kemiripan** (`/admin/wajah/audit`).
2. Klik **"Jalankan Audit"**.
3. Perhatikan nilai **Jarak Terkecil Antar-Wajah**:
   - Jika ada pasangan dengan jarak $< 0.46$, klik tombol **"Tandai Wajah Mirip"**.
   - Pasangan yang ditandai wajah mirip dijamin **100% tidak akan pernah langsung ACCEPT atas nama orang lain**, melainkan selalu memunculkan sheet konfirmasi identitas + 4 digit No ID.

### Langkah 5: Pengujian Scan di Tablet Pos Security
1. Lakukan scan absen pada kondisi normal:
   - Wajah yang jelas dan memiliki margin aman ($\ge 0.10$) akan langsung **ACCEPT** dalam $\le 2$ detik.
2. Lakukan scan pada dua orang yang memiliki kemiripan wajah:
   - Sistem akan memicu **Zona Konfirmasi** (`CONFIRM`).
   - Tablet menampilkan sheet pilihan nama kandidat (urutan diacak).
   - Setelah nama dipilih, tablet meminta input **4 karakter terakhir No ID** melalui keypad numerik besar ramah sentuhan.
   - Jika salah 3 kali berturut-turut, verifikasi terkunci dan dicatat di `audit_logs`.
3. Uji tombol pembatalan mandiri:
   - Pada pop-up sukses absensi (tampil selama 8 detik), klik tombol **"Bukan saya? Batalkan"**.
   - Konfirmasi pembatalan. Status kehadiran otomatis kembali ke kondisi sebelum scan.

### Langkah 6: Monitoring & Koreksi Admin
1. Buka menu **Review Absensi** (`/admin/wajah/review`).
2. Tinjau event yang masuk zona `confirm` atau yang dibatalkan mandiri (`voided`).
3. Jika terdapat absensi yang salah orang, klik tombol **"Koreksi"** untuk memindahkan jam absen ke karyawan yang sebenarnya dengan alasan wajib tercatat di audit log.

---

## 8. Proposal Fase 8 (Modular Face Embedder ArcFace / MobileFaceNet)

Aplikasi telah dilengkapi antarmuka modular `FaceEmbedder` pada `lib/face.ts`:

```ts
export interface FaceEmbedder {
  readonly dim: number;
  readonly name: string;
  extract(canvas: HTMLCanvasElement): Promise<number[] | null>;
}
```

Bila hasil audit di lapangan (`/admin/wajah/audit`) menunjukkan terlalu banyak pasangan rawan akibat keterbatasan model `faceRecognitionNet` (dlib ResNet era 2017), aplikasi dapat beralih ke model modern **MobileFaceNet / ArcFace (512-dimensi)** menggunakan runtime WebAssembly `onnxruntime-web` yang sangat ringan untuk tablet tanpa perlu merombak logika server maupun antarmuka aplikasi.


