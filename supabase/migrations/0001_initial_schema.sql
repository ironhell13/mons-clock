-- MonsClock (Aplikasi Absen Wajah Pos Security)
-- Initial database schema, views, indexes, and RLS policies

create extension if not exists pgcrypto;

-- ==========================================
-- 1. AUTH PROFILES
-- ==========================================
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  full_name text not null,
  role text not null check (role in ('superadmin', 'admin', 'absen')),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_profiles_updated_at on public.profiles;
create trigger trg_profiles_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

-- Helper function (SECURITY DEFINER) to inspect active user role without RLS recursion
create or replace function public.get_my_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select role
  from public.profiles
  where id = auth.uid()
    and is_active = true
  limit 1;
$$;

-- ==========================================
-- 2. MASTER TABLES
-- ==========================================
create table if not exists public.employees (
  id uuid primary key default gen_random_uuid(),
  rfid_no text,
  name text not null,
  position text not null,
  employee_no text not null unique,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.escorts (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  vendor text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  constraint escorts_name_vendor_unique unique (name, vendor)
);

create table if not exists public.areas (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.vehicles (
  id uuid primary key default gen_random_uuid(),
  plate text not null unique,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.workshops (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

-- ==========================================
-- 3. FACE TEMPLATES (128-dim numerical descriptors only, NO photos)
-- ==========================================
create table if not exists public.face_templates (
  id uuid primary key default gen_random_uuid(),
  subject_type text not null check (subject_type in ('employee', 'escort')),
  employee_id uuid references public.employees(id) on delete cascade,
  escort_id uuid references public.escorts(id) on delete cascade,
  descriptor double precision[] not null,
  sample_label text not null default 'lurus',
  created_at timestamptz not null default now(),
  constraint face_templates_subject_check check (
    (subject_type = 'employee' and employee_id is not null and escort_id is null) or
    (subject_type = 'escort' and escort_id is not null and employee_id is null)
  ),
  constraint face_templates_descriptor_length check (array_length(descriptor, 1) = 128)
);

create index if not exists idx_face_templates_employee on public.face_templates(employee_id) where employee_id is not null;
create index if not exists idx_face_templates_escort on public.face_templates(escort_id) where escort_id is not null;

-- ==========================================
-- 4. MUTASI KARYAWAN (ATTENDANCE)
-- ==========================================
create table if not exists public.attendance (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete cascade,
  work_date date not null,
  masuk_at timestamptz,
  istirahat_at timestamptz,
  pulang_at timestamptz,
  created_at timestamptz not null default now(),
  constraint attendance_employee_work_date_unique unique (employee_id, work_date)
);

create index if not exists idx_attendance_work_date on public.attendance(work_date desc);
create index if not exists idx_attendance_employee_open on public.attendance(employee_id, masuk_at desc) where pulang_at is null;

create table if not exists public.attendance_events (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete cascade,
  attendance_id uuid references public.attendance(id) on delete set null,
  event_type text not null check (event_type in ('masuk', 'istirahat', 'pulang')),
  occurred_at timestamptz not null default now(),
  match_distance double precision,
  created_at timestamptz not null default now()
);

create index if not exists idx_attendance_events_occurred on public.attendance_events(occurred_at desc);

-- ==========================================
-- 5. MUTASI FLM / RPL / CIT (TRIPS)
-- ==========================================
create table if not exists public.trips (
  id uuid primary key default gen_random_uuid(),
  trip_type text not null check (trip_type in ('FLM', 'RPL', 'CIT')),
  depart_at timestamptz not null default now(),
  return_at timestamptz,
  staff1_id uuid not null references public.employees(id) on delete restrict,
  staff2_id uuid references public.employees(id) on delete restrict,
  escort_id uuid references public.escorts(id) on delete restrict,
  plate text not null,
  km_start integer not null check (km_start >= 0),
  km_end integer check (km_end is null or km_end >= km_start),
  area_id uuid references public.areas(id) on delete restrict,
  run_code text,
  duration_minutes integer generated always as (
    case
      when return_at is not null then
        greatest(0, floor(extract(epoch from (return_at - depart_at)) / 60)::integer)
      else null
    end
  ) stored,
  total_km integer generated always as (
    case
      when km_end is not null then km_end - km_start
      else null
    end
  ) stored,
  created_at timestamptz not null default now(),
  constraint trips_different_staff check (staff2_id is null or staff2_id <> staff1_id),
  constraint trips_return_after_depart check (return_at is null or return_at >= depart_at),
  constraint trips_area_or_run_check check (
    (trip_type = 'FLM' and area_id is not null and run_code is null) or
    (trip_type in ('RPL', 'CIT') and area_id is null and run_code is not null and length(trim(run_code)) > 0)
  )
);

create index if not exists idx_trips_type_depart on public.trips(trip_type, depart_at desc);
create index if not exists idx_trips_open_plate on public.trips(plate) where return_at is null;
create index if not exists idx_trips_open_staff on public.trips(trip_type, staff1_id, staff2_id) where return_at is null;

-- Views matching exact Excel sheet column order and HH-MM duration format (WIB)
create or replace view public.v_mutasi_flm
with (security_invoker = true) as
select
  to_char(t.depart_at at time zone 'Asia/Jakarta', 'YYYY-MM-DD HH24:MI:SS') as "KELUAR",
  case
    when t.return_at is not null then to_char(t.return_at at time zone 'Asia/Jakarta', 'YYYY-MM-DD HH24:MI:SS')
    else null
  end as "KEMBALI",
  s1.name as "STAFF 1",
  s2.name as "STAFF 2",
  case
    when t.duration_minutes is not null then
      lpad((t.duration_minutes / 60)::text, 2, '0') || '-' || lpad((t.duration_minutes % 60)::text, 2, '0')
    else null
  end as "DURASI",
  e.name as "NAMA PENGAWAL",
  e.vendor as "VENDOR",
  t.plate as "NOPOL",
  t.km_start as "KM AWAL",
  t.km_end as "KM AKHIR",
  t.total_km as "TOTAL KM",
  a.name as "AREA"
from public.trips t
join public.employees s1 on s1.id = t.staff1_id
left join public.employees s2 on s2.id = t.staff2_id
left join public.escorts e on e.id = t.escort_id
left join public.areas a on a.id = t.area_id
where t.trip_type = 'FLM';

create or replace view public.v_mutasi_rpl
with (security_invoker = true) as
select
  to_char(t.depart_at at time zone 'Asia/Jakarta', 'YYYY-MM-DD HH24:MI:SS') as "KELUAR",
  case
    when t.return_at is not null then to_char(t.return_at at time zone 'Asia/Jakarta', 'YYYY-MM-DD HH24:MI:SS')
    else null
  end as "KEMBALI",
  s1.name as "STAFF 1",
  s2.name as "STAFF 2",
  case
    when t.duration_minutes is not null then
      lpad((t.duration_minutes / 60)::text, 2, '0') || '-' || lpad((t.duration_minutes % 60)::text, 2, '0')
    else null
  end as "DURASI",
  e.name as "NAMA PENGAWAL",
  e.vendor as "VENDOR",
  t.plate as "NOPOL",
  t.km_start as "KM AWAL",
  t.km_end as "KM AKHIR",
  t.total_km as "TOTAL KM",
  t.run_code as "RUN"
from public.trips t
join public.employees s1 on s1.id = t.staff1_id
left join public.employees s2 on s2.id = t.staff2_id
left join public.escorts e on e.id = t.escort_id
where t.trip_type = 'RPL';

create or replace view public.v_mutasi_cit
with (security_invoker = true) as
select
  to_char(t.depart_at at time zone 'Asia/Jakarta', 'YYYY-MM-DD HH24:MI:SS') as "KELUAR",
  case
    when t.return_at is not null then to_char(t.return_at at time zone 'Asia/Jakarta', 'YYYY-MM-DD HH24:MI:SS')
    else null
  end as "KEMBALI",
  s1.name as "STAFF 1",
  s2.name as "STAFF 2",
  case
    when t.duration_minutes is not null then
      lpad((t.duration_minutes / 60)::text, 2, '0') || '-' || lpad((t.duration_minutes % 60)::text, 2, '0')
    else null
  end as "DURASI",
  e.name as "NAMA PENGAWAL",
  e.vendor as "VENDOR",
  t.plate as "NOPOL",
  t.km_start as "KM AWAL",
  t.km_end as "KM AKHIR",
  t.total_km as "TOTAL KM",
  t.run_code as "RUN"
from public.trips t
join public.employees s1 on s1.id = t.staff1_id
left join public.employees s2 on s2.id = t.staff2_id
left join public.escorts e on e.id = t.escort_id
where t.trip_type = 'CIT';

-- ==========================================
-- 6. MUTASI ADMIN TABLES (-admin sheets)
-- ==========================================
create table if not exists public.guest_logs (
  id uuid primary key default gen_random_uuid(),
  log_date date not null,
  time_in time not null,
  time_out time,
  name text not null,
  vehicle_plate text,
  origin text not null,
  notes text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists idx_guest_logs_date on public.guest_logs(log_date desc);

create table if not exists public.workshop_logs (
  id uuid primary key default gen_random_uuid(),
  vehicle_plate text not null,
  out_date date not null,
  km_out integer not null check (km_out >= 0),
  finish_date date check (finish_date is null or finish_date >= out_date),
  km_back integer check (km_back is null or km_back >= km_out),
  total_km integer generated always as (
    case
      when km_back is not null then km_back - km_out
      else null
    end
  ) stored,
  repair_days integer generated always as (
    case
      when finish_date is not null then (finish_date - out_date)
      else null
    end
  ) stored,
  workshop_name text not null,
  insurance_type text not null check (insurance_type in ('non_asuransi', 'asuransi')),
  notes text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists idx_workshop_logs_out_date on public.workshop_logs(out_date desc);

create table if not exists public.goods_logs (
  id uuid primary key default gen_random_uuid(),
  direction text not null check (direction in ('masuk', 'keluar')),
  log_date date not null,
  time_in time,
  time_out time,
  name text not null,
  vehicle_plate text,
  item_name text not null,
  item_qty integer not null check (item_qty > 0),
  notes text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists idx_goods_logs_date on public.goods_logs(log_date desc);

-- ==========================================
-- 7. AUDIT LOGS
-- ==========================================
create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  action text not null,
  table_name text not null,
  record_id uuid,
  reason text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_audit_logs_created on public.audit_logs(created_at desc);

-- ==========================================
-- 8. ROW LEVEL SECURITY (RLS)
-- ==========================================
alter table public.profiles enable row level security;
alter table public.employees enable row level security;
alter table public.escorts enable row level security;
alter table public.areas enable row level security;
alter table public.vehicles enable row level security;
alter table public.workshops enable row level security;
alter table public.face_templates enable row level security;
alter table public.attendance enable row level security;
alter table public.attendance_events enable row level security;
alter table public.trips enable row level security;
alter table public.guest_logs enable row level security;
alter table public.workshop_logs enable row level security;
alter table public.goods_logs enable row level security;
alter table public.audit_logs enable row level security;

-- PROFILES: self-read + superadmin full CRUD
drop policy if exists "profiles_select_self" on public.profiles;
create policy "profiles_select_self" on public.profiles
  for select using (id = auth.uid());

drop policy if exists "profiles_superadmin_all" on public.profiles;
create policy "profiles_superadmin_all" on public.profiles
  for all
  using (public.get_my_role() = 'superadmin')
  with check (public.get_my_role() = 'superadmin');

-- MASTER TABLES: admin & superadmin full CRUD; absen read-only on kiosk-needed tables
-- employees
drop policy if exists "employees_admin_all" on public.employees;
create policy "employees_admin_all" on public.employees
  for all
  using (public.get_my_role() in ('admin', 'superadmin'))
  with check (public.get_my_role() in ('admin', 'superadmin'));

drop policy if exists "employees_absen_select" on public.employees;
create policy "employees_absen_select" on public.employees
  for select using (public.get_my_role() = 'absen');

-- escorts
drop policy if exists "escorts_admin_all" on public.escorts;
create policy "escorts_admin_all" on public.escorts
  for all
  using (public.get_my_role() in ('admin', 'superadmin'))
  with check (public.get_my_role() in ('admin', 'superadmin'));

drop policy if exists "escorts_absen_select" on public.escorts;
create policy "escorts_absen_select" on public.escorts
  for select using (public.get_my_role() = 'absen');

-- areas
drop policy if exists "areas_admin_all" on public.areas;
create policy "areas_admin_all" on public.areas
  for all
  using (public.get_my_role() in ('admin', 'superadmin'))
  with check (public.get_my_role() in ('admin', 'superadmin'));

drop policy if exists "areas_absen_select" on public.areas;
create policy "areas_absen_select" on public.areas
  for select using (public.get_my_role() = 'absen');

-- vehicles
drop policy if exists "vehicles_admin_all" on public.vehicles;
create policy "vehicles_admin_all" on public.vehicles
  for all
  using (public.get_my_role() in ('admin', 'superadmin'))
  with check (public.get_my_role() in ('admin', 'superadmin'));

drop policy if exists "vehicles_absen_select" on public.vehicles;
create policy "vehicles_absen_select" on public.vehicles
  for select using (public.get_my_role() = 'absen');

-- workshops (admin/superadmin only)
drop policy if exists "workshops_admin_all" on public.workshops;
create policy "workshops_admin_all" on public.workshops
  for all
  using (public.get_my_role() in ('admin', 'superadmin'))
  with check (public.get_my_role() in ('admin', 'superadmin'));

-- face_templates: admin/superadmin full CRUD; absen read-only (writes happen via verified server API)
drop policy if exists "face_templates_admin_all" on public.face_templates;
create policy "face_templates_admin_all" on public.face_templates
  for all
  using (public.get_my_role() in ('admin', 'superadmin'))
  with check (public.get_my_role() in ('admin', 'superadmin'));

drop policy if exists "face_templates_absen_select" on public.face_templates;
create policy "face_templates_absen_select" on public.face_templates
  for select using (public.get_my_role() = 'absen');

-- ATTENDANCE / EVENTS / TRIPS: admin/superadmin read/update; kiosk writes via server service_role
drop policy if exists "attendance_admin_all" on public.attendance;
create policy "attendance_admin_all" on public.attendance
  for all
  using (public.get_my_role() in ('admin', 'superadmin'))
  with check (public.get_my_role() in ('admin', 'superadmin'));

drop policy if exists "attendance_events_admin_select" on public.attendance_events;
create policy "attendance_events_admin_select" on public.attendance_events
  for select using (public.get_my_role() in ('admin', 'superadmin'));

drop policy if exists "trips_admin_all" on public.trips;
create policy "trips_admin_all" on public.trips
  for all
  using (public.get_my_role() in ('admin', 'superadmin'))
  with check (public.get_my_role() in ('admin', 'superadmin'));

-- MUTASI ADMIN TABLES: admin & superadmin full CRUD
drop policy if exists "guest_logs_admin_all" on public.guest_logs;
create policy "guest_logs_admin_all" on public.guest_logs
  for all
  using (public.get_my_role() in ('admin', 'superadmin'))
  with check (public.get_my_role() in ('admin', 'superadmin'));

drop policy if exists "workshop_logs_admin_all" on public.workshop_logs;
create policy "workshop_logs_admin_all" on public.workshop_logs
  for all
  using (public.get_my_role() in ('admin', 'superadmin'))
  with check (public.get_my_role() in ('admin', 'superadmin'));

drop policy if exists "goods_logs_admin_all" on public.goods_logs;
create policy "goods_logs_admin_all" on public.goods_logs
  for all
  using (public.get_my_role() in ('admin', 'superadmin'))
  with check (public.get_my_role() in ('admin', 'superadmin'));

-- AUDIT LOGS: admin & superadmin read & insert
drop policy if exists "audit_logs_admin_select" on public.audit_logs;
create policy "audit_logs_admin_select" on public.audit_logs
  for select using (public.get_my_role() in ('admin', 'superadmin'));

drop policy if exists "audit_logs_admin_insert" on public.audit_logs;
create policy "audit_logs_admin_insert" on public.audit_logs
  for insert with check (public.get_my_role() in ('admin', 'superadmin'));

