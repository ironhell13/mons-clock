-- Migration 0004: Face Recognition Security, Verification & Audit Trail
-- Menambahkan pgvector, face_verifications, face_lookalike_flags,
-- audit fields pada attendance_events, dan RPC match_faces.

create extension if not exists vector;

-- 1. Kolom tambahan pada template wajah
alter table public.face_templates
  add column if not exists embedding vector(128),
  add column if not exists pipeline_version smallint not null default 2,
  add column if not exists quality jsonb;

-- Migrasikan descriptor float array ke embedding vector jika belum ada
update public.face_templates
  set embedding = descriptor::vector(128)
  where embedding is null;

create index if not exists idx_face_templates_embedding on public.face_templates using ivfflat (embedding vector_l2_ops) with (lists = 10);

-- 2. Verifikasi identitas sekali pakai (server-side single-use verification)
create table if not exists public.face_verifications (
  id uuid primary key default gen_random_uuid(),
  kiosk_user_id uuid not null,
  purpose text not null check (purpose in ('absen','trip_staff1','trip_staff2','trip_escort')),
  subject_type text not null check (subject_type in ('employee','escort')),
  subject_id uuid,                       -- Terisi setelah ACCEPT atau setelah konfirmasi identitas berhasil
  zone text not null check (zone in ('accept','confirm','reject')),
  score numeric,                         -- Skor kandidat terbaik (d_top2)
  second_subject_id uuid,
  second_score numeric,
  margin numeric,
  frames_used int,
  candidates jsonb,                      -- Maks 3 kandidat (id & nama saja) untuk zona confirm
  confirm_attempts int not null default 0,
  confirmed_method text,                 -- 'no_id_last4' | 'rfid' | 'manual_select' | null
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  consumed_at timestamptz
);

create index if not exists idx_face_verifications_created on public.face_verifications(created_at desc);
create index if not exists idx_face_verifications_kiosk on public.face_verifications(kiosk_user_id, created_at desc);

-- 3. Jejak audit & kemampuan rollback pada event absen
alter table public.attendance_events
  add column if not exists verification_id uuid references public.face_verifications(id) on delete set null,
  add column if not exists second_subject_id uuid,
  add column if not exists second_distance double precision,
  add column if not exists margin double precision,
  add column if not exists decision_zone text check (decision_zone in ('accept','confirm','reject','manual')),
  add column if not exists frames_used int,
  add column if not exists before_state jsonb,   -- Snapshot baris attendance sebelum event (untuk pembatalan "Bukan saya")
  add column if not exists voided_at timestamptz,
  add column if not exists void_reason text;

create index if not exists idx_attendance_events_verification on public.attendance_events(verification_id);
create index if not exists idx_attendance_events_zone on public.attendance_events(decision_zone);

-- 4. Pasangan wajah mirip yang ditandai admin (selalu masuk zona confirm)
create table if not exists public.face_lookalike_flags (
  id uuid primary key default gen_random_uuid(),
  subject_type text not null check (subject_type in ('employee','escort')),
  subject_a uuid not null,
  subject_b uuid not null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint face_lookalike_unique_pair unique (subject_a, subject_b),
  constraint face_lookalike_diff_check check (subject_a <> subject_b)
);

create index if not exists idx_face_lookalike_a on public.face_lookalike_flags(subject_a);
create index if not exists idx_face_lookalike_b on public.face_lookalike_flags(subject_b);

-- 5. RPC Pencocokan per orang (d_top2: rata-rata jarak 2 sampel terdekat)
create or replace function public.match_faces(q vector(128), p_subject_type text)
returns table (
  subject_id uuid,
  n_samples int,
  d_min float8,
  d_top2 float8,
  d_mean float8
)
language sql stable security definer set search_path = public as $$
  with d as (
    select coalesce(employee_id, escort_id) as sid, (embedding <-> q)::float8 as dist
    from public.face_templates
    where subject_type = p_subject_type and embedding is not null
  ), r as (
    select sid, dist, row_number() over (partition by sid order by dist) as rn from d
  )
  select
    sid as subject_id,
    count(*)::int as n_samples,
    min(dist) as d_min,
    avg(dist) filter (where rn <= 2)::float8 as d_top2,
    avg(dist)::float8 as d_mean
  from r
  group by sid
  order by d_top2 asc
  limit 8;
$$;

revoke all on function public.match_faces(vector, text) from public, anon, authenticated;
grant execute on function public.match_faces(vector, text) to service_role;

-- 6. Enable RLS pada tabel baru
alter table public.face_verifications enable row level security;
alter table public.face_lookalike_flags enable row level security;

-- Policy face_verifications: Hanya service_role yang boleh baca/tulis langsung, admin boleh view
drop policy if exists "Admin view face_verifications" on public.face_verifications;
create policy "Admin view face_verifications" on public.face_verifications
  for select
  using (
    exists (
      select 1 from public.profiles
      where profiles.id = auth.uid() and profiles.role in ('admin','superadmin')
    )
  );

-- Policy face_lookalike_flags: Admin dan superadmin boleh select/insert/delete
drop policy if exists "Admin manage lookalike flags" on public.face_lookalike_flags;
create policy "Admin manage lookalike flags" on public.face_lookalike_flags
  for all
  using (
    exists (
      select 1 from public.profiles
      where profiles.id = auth.uid() and profiles.role in ('admin','superadmin')
    )
  )
  with check (
    exists (
      select 1 from public.profiles
      where profiles.id = auth.uid() and profiles.role in ('admin','superadmin')
    )
  );

