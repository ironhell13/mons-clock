-- Migration 0005: Role HRD, Validasi Koreksi, Master Pengawal NIG, dan Absensi Pengawal

-- 1. Perbarui check constraint pada profiles agar mendukung role 'hrd'
alter table public.profiles
  drop constraint if exists profiles_role_check;

alter table public.profiles
  add constraint profiles_role_check
  check (role in ('superadmin', 'admin', 'hrd', 'absen'));

-- 2. Tambahkan kolom NIG (Nomor Induk Guard) pada master escorts
alter table public.escorts
  add column if not exists nig text;

create index if not exists idx_escorts_nig on public.escorts(nig);

-- 3. Perbarui tabel attendance agar mendukung pengawal dan alur validasi koreksi HRD
alter table public.attendance
  alter column employee_id drop not null;

alter table public.attendance
  add column if not exists escort_id uuid references public.escorts(id) on delete cascade,
  add column if not exists subject_type text not null default 'employee' check (subject_type in ('employee', 'escort')),
  add column if not exists correction_status text check (correction_status in ('pending_hrd', 'approved_hrd', 'rejected_hrd')),
  add column if not exists correction_by uuid references auth.users(id),
  add column if not exists correction_reason text,
  add column if not exists correction_at timestamptz,
  add column if not exists validated_by uuid references auth.users(id),
  add column if not exists validated_at timestamptz,
  add column if not exists validation_notes text,
  add column if not exists previous_data jsonb;

-- Constraint unik per hari: untuk karyawan dan pengawal
alter table public.attendance
  drop constraint if exists attendance_employee_work_date_unique;

create unique index if not exists idx_attendance_employee_date
  on public.attendance(employee_id, work_date)
  where employee_id is not null;

create unique index if not exists idx_attendance_escort_date
  on public.attendance(escort_id, work_date)
  where escort_id is not null;

-- 4. Perbarui tabel attendance_events agar mendukung pengawal
alter table public.attendance_events
  alter column employee_id drop not null;

alter table public.attendance_events
  add column if not exists escort_id uuid references public.escorts(id) on delete cascade,
  add column if not exists subject_type text not null default 'employee' check (subject_type in ('employee', 'escort'));

create index if not exists idx_attendance_events_escort on public.attendance_events(escort_id);

-- 5. Perbarui RPC match_faces agar mendukung pencocokan gabungan ('all'/'absen') untuk kiosk
drop function if exists public.match_faces(vector, text);
drop function if exists public.match_faces(public.vector, text);
drop function if exists public.match_faces;

create or replace function public.match_faces(q vector(128), p_subject_type text)
returns table (
  subject_id uuid,
  subject_type text,
  n_samples int,
  d_min float8,
  d_top2 float8,
  d_mean float8
)
language sql stable security definer set search_path = public as $$
  with d as (
    select
      coalesce(employee_id, escort_id) as sid,
      subject_type as stype,
      (embedding <-> q)::float8 as dist
    from public.face_templates
    where
      (p_subject_type = 'all' or p_subject_type = 'absen' or subject_type = p_subject_type)
      and embedding is not null
  ), r as (
    select sid, stype, dist, row_number() over (partition by sid order by dist) as rn from d
  )
  select
    sid as subject_id,
    stype as subject_type,
    count(*)::int as n_samples,
    min(dist) as d_min,
    avg(dist) filter (where rn <= 2)::float8 as d_top2,
    avg(dist)::float8 as d_mean
  from r
  group by sid, stype
  order by d_top2 asc
  limit 8;
$$;

revoke all on function public.match_faces(vector, text) from public, anon, authenticated;
grant execute on function public.match_faces(vector, text) to service_role;

