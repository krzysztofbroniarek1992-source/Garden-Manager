// Optional embedded PostgreSQL validation; dependency stays outside the project.
// npm install --prefix /tmp/garden-manager-sql @electric-sql/pglite
// node supabase/tests/visits-and-settlements.test.mjs /tmp/garden-manager-sql
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';

if (!process.argv[2]) throw new Error('Podaj katalog instalacji @electric-sql/pglite.');
const { PGlite } = createRequire(resolve(process.argv[2], 'package.json'))('@electric-sql/pglite');
const db = new PGlite();
const owner = '10000000-0000-0000-0000-000000000001';
const other = '10000000-0000-0000-0000-000000000002';
const client = '20000000-0000-0000-0000-000000000001';
const garden = '30000000-0000-0000-0000-000000000001';
const legacy = '40000000-0000-0000-0000-000000000001';
const hourly = '40000000-0000-0000-0000-000000000002';
const fixed = '40000000-0000-0000-0000-000000000003';
const visit = '40000000-0000-0000-0000-000000000004';
const tombstone = '40000000-0000-0000-0000-000000000005';
const legacyPayment = '50000000-0000-0000-0000-000000000001';
const receipt = '50000000-0000-0000-0000-000000000002';
let checks = 0;
const execute = sql => db.exec(sql);
const value = async sql => Object.values((await db.query(sql)).rows[0])[0];
const check = async (sql, expected, label) => { assert.equal(await value(sql), expected, label); checks++; };
const rejects = async (sql, label) => { await assert.rejects(() => execute(sql), label); checks++; };
const approve = (id, cents, source, revision = `(select revision from public.jobs where id='${id}')`) =>
  `select public.approve_job_settlement('${id}',${cents},'${source}',${revision})`;

try {
  await execute(`create role anon; create role authenticated;
    create schema auth; create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql as
      $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema public,auth to anon,authenticated;
    insert into auth.users values ('${owner}'),('${other}');`);
  for (const filename of ['202611010001_initial_schema.sql', '202611010002_payments.sql'])
    await execute(await readFile(new URL(`../migrations/${filename}`, import.meta.url), 'utf8'));
  await execute(`insert into public.clients(id,owner_id,name) values ('${client}','${owner}','Klient');
    insert into public.gardens(id,owner_id,client_id,name) values ('${garden}','${owner}','${client}','Ogród');
    insert into public.jobs(id,owner_id,garden_id,title,scheduled_date,status,imported_seconds)
      values ('${legacy}','${owner}','${garden}','Historia 0.2','2026-10-30','completed',13620);
    insert into public.materials(owner_id,job_id,name,quantity,unit_price)
      values ('${owner}','${legacy}','Materiały',1,87);
    insert into public.jobs(id,owner_id,garden_id,title,scheduled_date,status,billing,fixed_price,deleted_at)
      values ('${tombstone}','${owner}','${garden}','Zachowany tombstone','2026-10-29','completed','fixed',77,now());
    insert into public.payments(id,owner_id,job_id,amount_cents,received_date,method)
      values ('${legacyPayment}','${owner}','${legacy}',20000,'2026-10-30','transfer');`);
  const previousValue = await value(`select public.job_value_cents('${owner}','${legacy}')::int`);
  assert.equal(previousValue, 54100); checks++;
  await execute(await readFile(new URL('../migrations/202611010003_visits_and_settlements.sql', import.meta.url), 'utf8'));
  await check(`select public.job_value_cents('${owner}','${legacy}')::int`, previousValue, 'Migration preserves old balance');
  await check(`select settlement_source from public.jobs where id='${legacy}'`, 'legacy', 'Migration records legacy snapshot');
  await check(`select labor_suggested_cents from public.jobs where id='${legacy}'`, null, 'Old completed job is not rounded');
  await check(`select activities[1] from public.jobs where id='${legacy}'`, 'Historia 0.2', 'Old title preserved as activity');
  await check(`select amount_cents::int from public.payments where id='${legacyPayment}'`, 20000, 'Payment preserved');
  await check(`select labor_approved_cents::int from public.jobs where id='${tombstone}'`, 7700, 'Completed tombstone gets exact legacy snapshot');
  await check(`select deleted_at is not null from public.jobs where id='${tombstone}'`, true, 'Migration does not restore a deleted job');
  await execute(`set role anon;`);
  await rejects(`select public.round_labor_to_50_cents(47500)`, 'Anonymous RPC calls denied');
  await execute(`reset role; set role authenticated; select set_config('request.jwt.claim.sub','${owner}',false);`);
  await rejects(`select public.job_value_cents('${owner}','${tombstone}')`, 'Deleted job remains unavailable for active billing');
  await rejects(`update public.jobs set status='planned' where id='${legacy}'`, 'Approved completed job cannot silently reopen');
  for (const [cents, expected] of [[27000,25000],[42000,40000],[45400,45000],[47500,50000],[52000,50000],[69000,70000]])
    await check(`select public.round_labor_to_50_cents(${cents})::int`, expected, `Half-up rounding ${cents}`);
  await rejects(`select public.round_labor_to_50_cents(-1)`, 'Negative rounding input denied');
  await execute(`insert into public.jobs(id,garden_id,title,scheduled_date,status,imported_seconds)
      values ('${hourly}','${garden}','Nowa wizyta','2026-10-30','completed',13620);
    insert into public.materials(job_id,name,quantity,unit_price) values ('${hourly}','Materiały',1,87);`);
  await rejects(`insert into public.payments(id,job_id,amount_cents,received_date,method)
    values ('${receipt}','${hourly}',1,'2026-10-30','cash')`, 'Pending completed price must be approved before a new payment');
  await execute(approve(hourly, 45000, 'rounded'));
  await check(`select public.job_value_cents('${owner}','${hourly}')::int`, 53700, '454 labour becomes450 plus87 materials');
  await check(`select labor_calculated_cents::int from public.jobs where id='${hourly}'`, 45400, 'Original calculated labour saved');
  await check(`select labor_suggested_cents::int from public.jobs where id='${hourly}'`, 45000, 'Rounded suggestion saved');
  await execute(`insert into public.payments(id,job_id,amount_cents,received_date,method)
    values ('${receipt}','${hourly}',20000,'2026-10-30','cash');`);
  const revision = await value(`select revision::int from public.jobs where id='${hourly}'`);
  await execute(`update public.jobs set hourly_rate=200, imported_seconds=7200,
      activities=array['Koszenie','Sprzątanie'] where id='${hourly}';
    update public.materials set unit_price=90 where job_id='${hourly}';`);
  await check(`select public.job_value_cents('${owner}','${hourly}')::int`, 53700, 'Approved total frozen after rate/time/material changes');
  await check(`select materials_approved_cents::int from public.jobs where id='${hourly}'`, 8700, 'Approved materials snapshot frozen');
  await rejects(approve(hourly, 45000, 'rounded', revision), 'Stale revision cannot approve a new price');
  await execute(`select public.correct_job_time('${hourly}',5400,(select revision from public.jobs where id='${hourly}'))`);
  await check(`select public.job_work_seconds('${owner}','${hourly}')::int`, 5400, 'Exact seconds correction retained');
  await rejects(`update public.jobs set time_correction_seconds=-100000 where id='${hourly}'`, 'Direct update cannot make visit time negative');
  await check(`select public.job_value_cents('${owner}','${hourly}')::int`, 53700, 'Manual time correction does not reprice an approved job');
  await rejects(approve(hourly, 0, 'manual'), 'Approved correction cannot fall below paid receipts');
  await rejects(`update public.jobs set labor_approved_cents=null where id='${hourly}'`, 'Partial snapshot rejected');
  await rejects(`update public.jobs set labor_calculated_cents=null,labor_suggested_cents=null,
    materials_approved_cents=null,labor_approved_cents=null,settlement_approved_at=null,settlement_source=null
    where id='${hourly}'`, 'Existing approval cannot silently be cleared');
  await execute(approve(hourly, 40000, 'manual'));
  await check(`select public.job_value_cents('${owner}','${hourly}')::int`, 49000, 'Explicit manual labour correction plus materials');
  await check(`select labor_calculated_cents::int from public.jobs where id='${hourly}'`, 30000, 'Reapproval keeps new original calculation');
  await execute(`insert into public.jobs(id,garden_id,title,scheduled_date,status,billing,fixed_price,imported_seconds)
    values ('${fixed}','${garden}','Ryczałt','2026-10-30','completed','fixed',454,7200);`);
  await rejects(approve(fixed, 45000, 'rounded'), 'Fixed price cannot use automatic50zl rounding');
  await execute(approve(fixed, 45400, 'fixed'));
  await check(`select public.job_value_cents('${owner}','${fixed}')::int`, 45400, 'Fixed labour stays454');
  await check(`select labor_suggested_cents from public.jobs where id='${fixed}'`, null, 'Fixed job has no rounded suggestion');
  await execute(`insert into public.jobs(id,garden_id,title,scheduled_date) values ('${visit}','${garden}','Wizyta z przerwą','2026-10-30');
    insert into public.work_sessions(job_id,started_at,ended_at) values
      ('${visit}','2026-10-30T10:00:00Z','2026-10-30T10:00:10Z'),
      ('${visit}','2026-10-30T10:10:00Z','2026-10-30T10:10:10Z');`);
  await check(`select public.job_work_seconds('${owner}','${visit}')::int`, 20, 'Only work segments count; ten-minute pause excluded');
  await execute(`insert into public.work_sessions(job_id,started_at) values ('${visit}',now());`);
  await rejects(`select public.correct_job_time('${visit}',10,(select revision from public.jobs where id='${visit}'))`, 'Active timer must stop before a correction');
  await execute(`select set_config('request.jwt.claim.sub','${other}',false);`);
  await rejects(approve(hourly, 40000, 'manual'), 'Another owner cannot approve a price');
  await rejects(`select public.correct_job_time('${hourly}',1,1)`, 'Another owner cannot correct time');
  await check(`select count(*)::int from public.jobs`, 0, 'RLS remains effective after schema extension');
  console.log(`${checks} visit/settlement SQL checks passed (embedded PostgreSQL; Auth roles stubbed).`);
} finally {
  await db.close();
}
