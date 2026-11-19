-- Migration 0006: Standarisasi Constraint Unik Absensi Karyawan & Pengawal
-- Memperbaiki error: "there is no unique or exclusion constraint matching the on conflict specification"

-- 1. Hapus partial index (yang memiliki klausa WHERE) karena PostgreSQL tidak mengizinkan
-- ON CONFLICT tanpa predicate untuk mencocokkan partial index.
drop index if exists public.idx_attendance_employee_date;
drop index if exists public.idx_attendance_escort_date;

-- 2. Hapus constraint lama jika ada
alter table public.attendance
  drop constraint if exists attendance_employee_work_date_unique;

alter table public.attendance
  drop constraint if exists attendance_escort_work_date_unique;

-- 3. Tambahkan constraint UNIQUE standar pada (employee_id, work_date) dan (escort_id, work_date)
-- Pada standar SQL dan PostgreSQL, nilai NULL diperlakukan unik secara independen (tidak saling berkonflik).
-- Artinya:
-- - Banyak pengawal (employee_id IS NULL) bisa absen pada tanggal kerja yang sama tanpa bentrok.
-- - Banyak karyawan (escort_id IS NULL) bisa absen pada tanggal kerja yang sama tanpa bentrok.
-- - ON CONFLICT (employee_id, work_date) dan ON CONFLICT (escort_id, work_date) dapat dikenali sempurna oleh database.
alter table public.attendance
  add constraint attendance_employee_work_date_unique
  unique (employee_id, work_date);

alter table public.attendance
  add constraint attendance_escort_work_date_unique
  unique (escort_id, work_date);
