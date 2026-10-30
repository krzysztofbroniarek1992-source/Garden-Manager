-- Garden Manager 0.3: exact visit time and explicitly approved labour prices.
-- Apply after 0002. Existing completed balances and receipts are preserved.
begin;

alter table public.jobs
  add column activities text[] not null default '{}',
  add column time_correction_seconds bigint not null default 0
    check (time_correction_seconds between -9007199254740991 and 9007199254740991),
  add column labor_calculated_cents bigint,
  add column labor_suggested_cents bigint,
  add column materials_approved_cents bigint,
  add column labor_approved_cents bigint,
  add column settlement_approved_at timestamptz,
  add column settlement_source text,
  add constraint complete_settlement_snapshot check (
    (labor_calculated_cents is null and labor_suggested_cents is null
      and materials_approved_cents is null and labor_approved_cents is null
      and settlement_approved_at is null and settlement_source is null)
    or
    (status = 'completed' and labor_calculated_cents is not null and materials_approved_cents is not null
      and labor_approved_cents is not null and settlement_source is not null
      and labor_calculated_cents between 0 and 9007199254740991
      and materials_approved_cents between 0 and 9007199254740991
      and labor_approved_cents between 0 and 9007199254740991
      and labor_approved_cents + materials_approved_cents <= 9007199254740991
      and settlement_approved_at is not null and isfinite(settlement_approved_at)
      and settlement_source in ('legacy', 'rounded', 'manual', 'fixed', 'exact')
      and (labor_suggested_cents is null or labor_suggested_cents between 0 and 9007199254740991)
      and (settlement_source not in ('legacy', 'fixed') or labor_suggested_cents is null)
      and (settlement_source not in ('legacy', 'fixed', 'exact') or labor_approved_cents = labor_calculated_cents)
      and (settlement_source <> 'rounded' or (labor_suggested_cents is not null and labor_approved_cents = labor_suggested_cents)))
  );

create function public.job_work_seconds(p_owner_id uuid, p_job_id uuid)
returns bigint language plpgsql security invoker set search_path = '' as $$
declare result numeric;
begin
  select j.imported_seconds + j.time_correction_seconds + coalesce((
    select sum(greatest(0, floor(extract(epoch from
      (coalesce(s.ended_at, statement_timestamp()) - s.started_at)))))
    from public.work_sessions s where s.owner_id = j.owner_id
      and s.job_id = j.id and s.deleted_at is null), 0)
    into result from public.jobs j
    where j.owner_id = p_owner_id and j.id = p_job_id;
  if result is null then raise exception 'Nie znaleziono własnego zlecenia.'; end if;
  if result < 0 or result > 9007199254740991 then
    raise exception 'Czas wizyty jest poza bezpiecznym zakresem.';
  end if;
  return result::bigint;
end;
$$;

create function public.job_calculated_labor_cents(p_owner_id uuid, p_job_id uuid)
returns bigint language plpgsql security invoker set search_path = '' as $$
declare job public.jobs%rowtype; result numeric;
begin
  select * into job from public.jobs
    where owner_id = p_owner_id and id = p_job_id;
  if not found then raise exception 'Nie znaleziono własnego zlecenia.'; end if;
  result := case when job.billing = 'fixed' then round(job.fixed_price * 100)
    else round(public.job_work_seconds(p_owner_id, p_job_id)::numeric
      * round(job.hourly_rate * 100) / 3600) end;
  if result < 0 or result > 9007199254740991 then
    raise exception 'Robocizna przekracza bezpieczny zakres kwot.';
  end if;
  return result::bigint;
end;
$$;

create function public.job_materials_cents(p_owner_id uuid, p_job_id uuid)
returns bigint language plpgsql security invoker set search_path = '' as $$
declare result numeric;
begin
  if not exists (select 1 from public.jobs where owner_id = p_owner_id
      and id = p_job_id) then
    raise exception 'Nie znaleziono własnego zlecenia.';
  end if;
  select coalesce(round(sum(quantity * round(unit_price * 100))), 0)
    into result from public.materials
    where owner_id = p_owner_id and job_id = p_job_id and deleted_at is null;
  if result < 0 or result > 9007199254740991 then
    raise exception 'Materiały przekraczają bezpieczny zakres kwot.';
  end if;
  return result::bigint;
end;
$$;

create function public.round_labor_to_50_cents(p_cents bigint)
returns bigint language plpgsql immutable security invoker set search_path = '' as $$
declare result bigint;
begin
  if p_cents is null or p_cents < 0 or p_cents > 9007199254740991 then
    raise exception 'Nieprawidłowa wartość robocizny.';
  end if;
  result := ((p_cents + 2500) / 5000) * 5000;
  if result > 9007199254740991 then raise exception 'Zaokrąglona kwota jest zbyt duża.'; end if;
  return result;
end;
$$;

-- Freeze the exact pre-0.3 amount, not the new 50 zł suggestion. Payments are
-- untouched and no payment/settlement status is inferred from completion.
update public.jobs set activities = array[title];
update public.jobs set
  labor_calculated_cents = public.job_calculated_labor_cents(owner_id, id),
  labor_suggested_cents = null,
  materials_approved_cents = public.job_materials_cents(owner_id, id),
  labor_approved_cents = public.job_calculated_labor_cents(owner_id, id),
  settlement_approved_at = statement_timestamp(),
  settlement_source = 'legacy'
where status = 'completed';

create or replace function public.job_value_cents(p_owner_id uuid, p_job_id uuid)
returns bigint language plpgsql security invoker set search_path = '' as $$
declare job public.jobs%rowtype; result numeric;
begin
  select * into job from public.jobs
    where owner_id = p_owner_id and id = p_job_id and deleted_at is null;
  if not found then raise exception 'Nie znaleziono własnego zlecenia.'; end if;
  if job.settlement_approved_at is not null then
    result := job.labor_approved_cents + job.materials_approved_cents;
  else
    result := public.job_calculated_labor_cents(p_owner_id, p_job_id)::numeric
      + public.job_materials_cents(p_owner_id, p_job_id);
  end if;
  if result < 0 or result > 9007199254740991 then
    raise exception 'Należność przekracza bezpieczny zakres kwot.';
  end if;
  return result::bigint;
end;
$$;

create function public.preserve_settlement_snapshot()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if old.settlement_approved_at is not null and new.settlement_approved_at is null then
    raise exception 'Nie usuwaj zatwierdzonej należności. Zapisz jawną korektę ceny.';
  end if;
  return new;
end;
$$;
create trigger preserve_settlement_snapshot before update on public.jobs
  for each row execute function public.preserve_settlement_snapshot();

create function public.validate_job_visit_time()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if new.deleted_at is null then perform public.job_work_seconds(new.owner_id, new.id); end if;
  return new;
end;
$$;
create trigger validate_job_visit_time after insert or update on public.jobs
  for each row execute function public.validate_job_visit_time();

-- A correction must stay valid when old sessions are subsequently changed.
create or replace function public.check_job_cost_change()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if tg_op <> 'INSERT' and exists (select 1 from public.jobs
      where owner_id = old.owner_id and id = old.job_id and deleted_at is null) then
    perform public.job_work_seconds(old.owner_id, old.job_id);
    perform public.assert_job_balance(old.owner_id, old.job_id);
  end if;
  if tg_op <> 'DELETE' then
    perform public.job_work_seconds(new.owner_id, new.job_id);
    perform public.assert_job_balance(new.owner_id, new.job_id);
    return new;
  end if;
  return old;
end;
$$;

-- Additive guard keeps the existing 0002 owner/overpayment locking trigger.
-- Advances on planned jobs remain possible; a completed visit needs an agreed
-- price before another receipt is added. Existing receipts remain correctable.
create function public.require_price_for_completed_payment()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if new.deleted_at is null and exists (select 1 from public.jobs
      where owner_id = new.owner_id and id = new.job_id
        and status = 'completed' and settlement_approved_at is null) then
    raise exception 'Najpierw zatwierdź cenę robocizny zakończonej wizyty.';
  end if;
  return new;
end;
$$;
create trigger require_price_for_completed_payment before insert on public.payments
  for each row execute function public.require_price_for_completed_payment();

-- The caller supplies the last observed job revision. Cost/payment changes also
-- bump it (0002), so an outdated approval fails instead of silently repricing.
create function public.approve_job_settlement(
  p_job_id uuid, p_final_labor_cents bigint, p_source text, p_expected_revision bigint
)
returns public.jobs language plpgsql security invoker set search_path = '' as $$
declare job public.jobs%rowtype; calculated bigint; suggested bigint; materials bigint;
begin
  select * into job from public.jobs
    where owner_id = auth.uid() and id = p_job_id and deleted_at is null for update;
  if not found then raise exception 'Nie znaleziono własnego zlecenia.'; end if;
  if p_expected_revision is null or job.revision <> p_expected_revision then
    raise exception 'Zlecenie zmieniono. Wczytaj aktualne dane przed zatwierdzeniem.';
  end if;
  if job.status <> 'completed' or exists (select 1 from public.work_sessions
      where owner_id = job.owner_id and job_id = job.id and ended_at is null and deleted_at is null) then
    raise exception 'Najpierw zakończ wizytę i pomiar czasu.';
  end if;
  if p_final_labor_cents is null or p_final_labor_cents < 0 or p_final_labor_cents > 9007199254740991
      or p_source is null or p_source not in ('rounded', 'manual', 'fixed', 'exact') then
    raise exception 'Podaj prawidłową zatwierdzoną cenę robocizny.';
  end if;
  calculated := public.job_calculated_labor_cents(job.owner_id, job.id);
  suggested := case when job.billing = 'hourly' then public.round_labor_to_50_cents(calculated) else null end;
  materials := public.job_materials_cents(job.owner_id, job.id);
  if (p_source = 'rounded' and (suggested is null or p_final_labor_cents <> suggested))
      or (p_source = 'fixed' and (job.billing <> 'fixed' or p_final_labor_cents <> calculated))
      or (p_source = 'exact' and p_final_labor_cents <> calculated) then
    raise exception 'Wybrana cena nie odpowiada wskazanemu sposobowi rozliczenia.';
  end if;
  update public.jobs set labor_calculated_cents = calculated,
    labor_suggested_cents = suggested, materials_approved_cents = materials,
    labor_approved_cents = p_final_labor_cents, settlement_source = p_source,
    settlement_approved_at = statement_timestamp()
    where owner_id = job.owner_id and id = job.id returning * into job;
  -- Existing check_job_balance AFTER UPDATE rejects an amount below receipts.
  return job;
end;
$$;

create function public.correct_job_time(
  p_job_id uuid, p_total_seconds bigint, p_expected_revision bigint
)
returns public.jobs language plpgsql security invoker set search_path = '' as $$
declare job public.jobs%rowtype; current_seconds bigint;
begin
  select * into job from public.jobs
    where owner_id = auth.uid() and id = p_job_id and deleted_at is null for update;
  if not found then raise exception 'Nie znaleziono własnego zlecenia.'; end if;
  if p_expected_revision is null or job.revision <> p_expected_revision then
    raise exception 'Zlecenie zmieniono. Wczytaj aktualne dane przed korektą czasu.';
  end if;
  if p_total_seconds is null or p_total_seconds < 0 or p_total_seconds > 9007199254740991 then
    raise exception 'Podaj czas w pełnych sekundach.';
  end if;
  if exists (select 1 from public.work_sessions where owner_id = job.owner_id
      and job_id = job.id and ended_at is null and deleted_at is null) then
    raise exception 'Zakończ pomiar przed ręczną korektą czasu.';
  end if;
  current_seconds := public.job_work_seconds(job.owner_id, job.id);
  update public.jobs set time_correction_seconds = time_correction_seconds + p_total_seconds - current_seconds
    where owner_id = job.owner_id and id = job.id returning * into job;
  -- Approved price columns are deliberately unchanged.
  return job;
end;
$$;

revoke all on function public.job_work_seconds(uuid, uuid),
  public.job_calculated_labor_cents(uuid, uuid), public.job_materials_cents(uuid, uuid),
  public.round_labor_to_50_cents(bigint),
  public.preserve_settlement_snapshot(), public.validate_job_visit_time(),
  public.require_price_for_completed_payment(),
  public.approve_job_settlement(uuid, bigint, text, bigint),
  public.correct_job_time(uuid, bigint, bigint) from public, anon;
grant execute on function public.job_work_seconds(uuid, uuid),
  public.job_calculated_labor_cents(uuid, uuid), public.job_materials_cents(uuid, uuid),
  public.round_labor_to_50_cents(bigint),
  public.approve_job_settlement(uuid, bigint, text, bigint),
  public.correct_job_time(uuid, bigint, bigint) to authenticated;

commit;
