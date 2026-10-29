-- Garden Manager 0.2: owner-scoped payment ledger. Run after 0001.
-- Existing jobs receive no synthetic payments: completion never implies payment.
begin;

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  job_id uuid not null,
  amount_cents bigint not null check (amount_cents > 0 and amount_cents <= 9007199254740991),
  received_date date not null check (isfinite(received_date)),
  method text not null check (method in ('cash', 'transfer', 'blik', 'other')),
  note text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  revision bigint not null default 1 check (revision > 0),
  unique (owner_id, id),
  foreign key (owner_id, job_id) references public.jobs(owner_id, id) on delete cascade
);

create index payments_owner_job on public.payments(owner_id, job_id);
create index payments_owner_received_date on public.payments(owner_id, received_date);
alter table public.payments enable row level security;
alter table public.payments force row level security;
revoke all on table public.payments from public, anon;
grant select, insert, update, delete on table public.payments to authenticated;
create policy owner_select on public.payments for select to authenticated
  using ((select auth.uid()) = owner_id);
create policy owner_insert on public.payments for insert to authenticated
  with check ((select auth.uid()) = owner_id);
create policy owner_update on public.payments for update to authenticated
  using ((select auth.uid()) = owner_id) with check ((select auth.uid()) = owner_id);
create policy owner_delete on public.payments for delete to authenticated
  using ((select auth.uid()) = owner_id);
create trigger touch_record before insert or update on public.payments
  for each row execute function public.touch_record();

-- Exact numeric intermediates, rounded at the same boundaries as the local
-- integer-cent model: hourly labour once; aggregated materials once; then sum.
-- SECURITY INVOKER means these functions and their triggers retain RLS.
create function public.job_value_cents(p_owner_id uuid, p_job_id uuid)
returns bigint language plpgsql security invoker set search_path = '' as $$
declare
  job public.jobs%rowtype;
  work_seconds numeric;
  value_cents numeric;
begin
  select * into job from public.jobs
    where owner_id = p_owner_id and id = p_job_id and deleted_at is null;
  if not found then raise exception 'Nie znaleziono aktywnego zlecenia.'; end if;
  select job.imported_seconds + coalesce(sum(greatest(0,
      floor(extract(epoch from (coalesce(ended_at, statement_timestamp()) - started_at))))), 0)
    into work_seconds from public.work_sessions
    where owner_id = p_owner_id and job_id = p_job_id and deleted_at is null;
  value_cents := case when job.billing = 'fixed' then round(job.fixed_price * 100)
    else round(work_seconds * round(job.hourly_rate * 100) / 3600) end;
  select value_cents + coalesce(round(sum(quantity * round(unit_price * 100))), 0)
    into value_cents from public.materials
    where owner_id = p_owner_id and job_id = p_job_id and deleted_at is null;
  if value_cents < 0 or value_cents > 9007199254740991 then
    raise exception 'Wartość zlecenia przekracza bezpieczny zakres kwot.';
  end if;
  return value_cents::bigint;
end;
$$;

create function public.assert_job_balance(p_owner_id uuid, p_job_id uuid)
returns void language plpgsql security invoker set search_path = '' as $$
declare paid numeric;
begin
  select coalesce(sum(amount_cents), 0) into paid from public.payments
    where owner_id = p_owner_id and job_id = p_job_id and deleted_at is null;
  if paid = 0 then return; end if;
  if paid > public.job_value_cents(p_owner_id, p_job_id) then
    raise exception 'Płatności przekraczają należność. Najpierw skoryguj rejestr płatności.';
  end if;
end;
$$;

-- All ledger writes serialize on the parent job. Concurrent partial payments
-- therefore cannot each spend the same remaining balance.
create function public.guard_payment()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare paid numeric; total bigint;
begin
  if tg_op = 'UPDATE' and
    (new.id, new.owner_id, new.job_id) is distinct from (old.id, old.owner_id, old.job_id) then
    raise exception 'Nie można przenosić zapisanej płatności do innego zlecenia lub właściciela.';
  end if;
  if tg_op = 'DELETE' then
    perform 1 from public.jobs where owner_id = old.owner_id and id = old.job_id for update;
    return old;
  end if;
  -- Also create a parent row version: under REPEATABLE READ a stale competing
  -- writer must receive a serialization error rather than use a stale balance.
  update public.jobs set updated_at = statement_timestamp()
    where owner_id = new.owner_id and id = new.job_id and deleted_at is null;
  if not found then raise exception 'Nie znaleziono własnego aktywnego zlecenia.'; end if;
  -- A concurrent customer reassignment must either finish before this receipt
  -- is entered or observe it and reject the reassignment.
  perform 1 from public.gardens g join public.jobs j
    on (j.owner_id, j.garden_id) = (g.owner_id, g.id)
    where j.owner_id = new.owner_id and j.id = new.job_id for share of g;
  if new.deleted_at is not null then return new; end if;
  total := public.job_value_cents(new.owner_id, new.job_id);
  select coalesce(sum(amount_cents), 0) into paid from public.payments
    where owner_id = new.owner_id and job_id = new.job_id and deleted_at is null
      and id <> new.id;
  if paid + new.amount_cents > total then
    raise exception 'Kwota płatności przekracza pozostałą należność.';
  end if;
  return new;
end;
$$;
create trigger guard_payment before insert or update or delete on public.payments
  for each row execute function public.guard_payment();

-- A job with recorded receipts cannot silently move to another customer,
-- disappear, or become worth less than the receipts already registered.
create function public.guard_paid_job()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if exists (select 1 from public.payments
      where owner_id = old.owner_id and job_id = old.id and deleted_at is null) then
    -- Account removal by a trusted administrator cascades through all tables.
    -- Ordinary authenticated application writes must first correct the ledger.
    if tg_op = 'DELETE' then
      if auth.uid() is not null then raise exception 'Zlecenie ma płatności. Najpierw skoryguj rejestr.'; end if;
      return old;
    end if;
    if (new.id, new.owner_id, new.garden_id) is distinct from (old.id, old.owner_id, old.garden_id)
       or new.deleted_at is not null then
      raise exception 'Nie można przenieść ani usunąć zlecenia z płatnościami.';
    end if;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;
create trigger guard_paid_job before update or delete on public.jobs
  for each row execute function public.guard_paid_job();

create function public.check_job_balance_after_change()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  perform public.assert_job_balance(new.owner_id, new.id);
  return new;
end;
$$;
create trigger check_job_balance after update on public.jobs
  for each row execute function public.check_job_balance_after_change();

-- Lock before material/session changes and check after the new value is visible.
-- Ordered parent locking also covers moves between two jobs without lock inversion.
create function public.lock_job_cost_change()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    perform 1 from public.jobs where owner_id = new.owner_id and id = new.job_id for update;
    update public.jobs set updated_at = statement_timestamp()
      where owner_id = new.owner_id and id = new.job_id;
  elsif tg_op = 'DELETE' then
    perform 1 from public.jobs where owner_id = old.owner_id and id = old.job_id for update;
    update public.jobs set updated_at = statement_timestamp()
      where owner_id = old.owner_id and id = old.job_id;
  else
    perform 1 from public.jobs where (owner_id, id) in
      ((old.owner_id, old.job_id), (new.owner_id, new.job_id)) order by id for update;
    update public.jobs set updated_at = statement_timestamp()
      where (owner_id, id) in ((old.owner_id, old.job_id), (new.owner_id, new.job_id));
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

create function public.check_job_cost_change()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if tg_op <> 'INSERT' then
    if exists (select 1 from public.jobs where owner_id = old.owner_id and id = old.job_id) then
      perform public.assert_job_balance(old.owner_id, old.job_id);
    end if;
  end if;
  if tg_op <> 'DELETE' then
    perform public.assert_job_balance(new.owner_id, new.job_id);
    return new;
  end if;
  return old;
end;
$$;
create trigger lock_job_cost before insert or update or delete on public.materials
  for each row execute function public.lock_job_cost_change();
create trigger check_job_cost after insert or update or delete on public.materials
  for each row execute function public.check_job_cost_change();
create trigger lock_job_cost before insert or update or delete on public.work_sessions
  for each row execute function public.lock_job_cost_change();
create trigger check_job_cost after insert or update or delete on public.work_sessions
  for each row execute function public.check_job_cost_change();

create function public.guard_paid_garden()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if (new.owner_id, new.client_id) is distinct from (old.owner_id, old.client_id) and exists (
    select 1 from public.jobs j join public.payments p
      on (p.owner_id, p.job_id) = (j.owner_id, j.id)
      where j.owner_id = old.owner_id and j.garden_id = old.id and p.deleted_at is null
  ) then
    raise exception 'Ogród ma zlecenia z płatnościami. Nie można zmienić przypisanego klienta.';
  end if;
  return new;
end;
$$;
create trigger guard_paid_garden before update on public.gardens
  for each row execute function public.guard_paid_garden();

revoke all on function public.job_value_cents(uuid, uuid),
  public.assert_job_balance(uuid, uuid), public.guard_payment(),
  public.guard_paid_job(), public.check_job_balance_after_change(),
  public.lock_job_cost_change(), public.check_job_cost_change(), public.guard_paid_garden()
  from public, anon;
grant execute on function public.job_value_cents(uuid, uuid), public.assert_job_balance(uuid, uuid)
  to authenticated;

commit;
