-- Garden Manager: future authenticated storage. Demo mode does not use this file.
-- Run in a Supabase project (auth.users and auth.uid() are supplied by Supabase).
begin;

create table public.clients (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null check (length(btrim(name)) > 0),
  phone text not null default '',
  email text not null default '',
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  revision bigint not null default 1 check (revision > 0),
  unique (owner_id, id)
);

create table public.gardens (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  client_id uuid not null,
  name text not null check (length(btrim(name)) > 0),
  address text not null default '',
  area numeric(12, 2) not null default 0 check (area >= 0 and area <> 'NaN'::numeric),
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  revision bigint not null default 1 check (revision > 0),
  unique (owner_id, id),
  foreign key (owner_id, client_id) references public.clients(owner_id, id)
);

create table public.jobs (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  garden_id uuid not null,
  title text not null check (length(btrim(title)) > 0),
  scheduled_date date not null,
  scheduled_time time not null default '09:00',
  status text not null default 'planned' check (status in ('planned', 'in-progress', 'completed')),
  billing text not null default 'hourly' check (billing in ('hourly', 'fixed')),
  hourly_rate numeric(12, 2) not null default 120 check (hourly_rate >= 0 and hourly_rate <> 'NaN'::numeric),
  fixed_price numeric(12, 2) not null default 0 check (fixed_price >= 0 and fixed_price <> 'NaN'::numeric),
  -- One-time import of locally accumulated time; subsequent time is in work_sessions.
  imported_seconds bigint not null default 0 check (imported_seconds >= 0),
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  revision bigint not null default 1 check (revision > 0),
  unique (owner_id, id),
  foreign key (owner_id, garden_id) references public.gardens(owner_id, id)
);

create table public.materials (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  job_id uuid not null,
  name text not null check (length(btrim(name)) > 0),
  quantity numeric(12, 3) not null check (quantity > 0 and quantity <> 'NaN'::numeric),
  unit_price numeric(12, 2) not null check (unit_price >= 0 and unit_price <> 'NaN'::numeric),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  revision bigint not null default 1 check (revision > 0),
  unique (owner_id, id),
  foreign key (owner_id, job_id) references public.jobs(owner_id, id) on delete cascade
);

create table public.work_sessions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  job_id uuid not null,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  revision bigint not null default 1 check (revision > 0),
  unique (owner_id, id),
  check (isfinite(started_at)),
  check (ended_at is null or (isfinite(ended_at) and ended_at >= started_at)),
  foreign key (owner_id, job_id) references public.jobs(owner_id, id) on delete cascade
);

-- This database constraint also arbitrates simultaneous starts on two devices.
create unique index work_sessions_one_active_per_owner
  on public.work_sessions(owner_id)
  where ended_at is null and deleted_at is null;

create table public.settings (
  owner_id uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  hourly_rate numeric(12, 2) not null default 120 check (hourly_rate >= 0 and hourly_rate <> 'NaN'::numeric),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  revision bigint not null default 1 check (revision > 0)
);

create index gardens_owner_client on public.gardens(owner_id, client_id);
create index jobs_owner_date on public.jobs(owner_id, scheduled_date);
create index jobs_owner_garden on public.jobs(owner_id, garden_id);
create index materials_owner_job on public.materials(owner_id, job_id);
create index work_sessions_owner_job on public.work_sessions(owner_id, job_id);

-- Revisions are server-generated and support compare-and-swap writes by an adapter.
create function public.touch_record()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.created_at := statement_timestamp();
    new.revision := 1;
  else
    new.created_at := old.created_at;
    new.revision := old.revision + 1;
  end if;
  new.updated_at := statement_timestamp();
  return new;
end;
$$;

-- Generate the same ownership policies and timestamp trigger for every app table.
do $$
declare
  table_name text;
begin
  foreach table_name in array array['clients', 'gardens', 'jobs', 'materials', 'work_sessions', 'settings']
  loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format('alter table public.%I force row level security', table_name);
    execute format('revoke all on table public.%I from public, anon', table_name);
    execute format('grant select, insert, update, delete on table public.%I to authenticated', table_name);
    execute format('create policy owner_select on public.%I for select to authenticated using ((select auth.uid()) = owner_id)', table_name);
    execute format('create policy owner_insert on public.%I for insert to authenticated with check ((select auth.uid()) = owner_id)', table_name);
    execute format('create policy owner_update on public.%I for update to authenticated using ((select auth.uid()) = owner_id) with check ((select auth.uid()) = owner_id)', table_name);
    execute format('create policy owner_delete on public.%I for delete to authenticated using ((select auth.uid()) = owner_id)', table_name);
    execute format('create trigger touch_record before insert or update on public.%I for each row execute function public.touch_record()', table_name);
  end loop;
end;
$$;

revoke all on function public.touch_record() from public, anon;

commit;
