-- Migration 0003: Menambahkan kolom istirahat_kembali_at pada public.attendance
-- serta memperbarui check constraint pada public.attendance_events untuk mencatat jam kembali istirahat.

alter table public.attendance
  add column if not exists istirahat_kembali_at timestamptz;

-- Update constraint event_type pada attendance_events
alter table public.attendance_events
  drop constraint if exists attendance_events_event_type_check;

alter table public.attendance_events
  add constraint attendance_events_event_type_check
  check (event_type in ('masuk', 'istirahat', 'istirahat_kembali', 'pulang'));

comment on column public.attendance.istirahat_at is 'Jam mulai istirahat (WIB / timestamptz)';
comment on column public.attendance.istirahat_kembali_at is 'Jam kembali/selesai istirahat (WIB / timestamptz)';

