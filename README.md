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
   - Setel orientasi layar ke **Landscape** (kunci rotasi ke landscape).
   - Nonaktifkan auto-lock / ubah **Screen Timeout** ke maksimal atau gunakan mode **Always On / Kiosk** selama tersambung daya.
   - Pastikan pencahayaan di area pos security cukup terang dan tidak membelakangi lampu agar deteksi wajah cepat dan akurat.

