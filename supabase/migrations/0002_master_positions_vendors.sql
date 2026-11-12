-- Migration 0002: Master Jabatan (positions) & Master Vendor (vendors)

create table if not exists public.positions (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.vendors (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.positions enable row level security;
alter table public.vendors enable row level security;

drop policy if exists "positions_admin_all" on public.positions;
create policy "positions_admin_all" on public.positions
  for all
  using (public.get_my_role() in ('admin', 'superadmin'))
  with check (public.get_my_role() in ('admin', 'superadmin'));

drop policy if exists "vendors_admin_all" on public.vendors;
create policy "vendors_admin_all" on public.vendors
  for all
  using (public.get_my_role() in ('admin', 'superadmin'))
  with check (public.get_my_role() in ('admin', 'superadmin'));

-- Isi otomatis dari data karyawan & pengawal yang sudah ada
insert into public.positions (name)
select distinct trim(regexp_replace(position, '\s+', ' ', 'g'))
from public.employees
where trim(position) <> '' and trim(position) <> '-'
on conflict (name) do nothing;

insert into public.vendors (name)
select distinct trim(regexp_replace(vendor, '\s+', ' ', 'g'))
from public.escorts
where trim(vendor) <> ''
on conflict (name) do nothing;
