// Optional embedded PostgreSQL check. Keep its dependency outside the project:
// npm install --prefix /tmp/garden-manager-sql @electric-sql/pglite
// node supabase/tests/payments.test.mjs /tmp/garden-manager-sql
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';

const dependencyRoot = process.argv[2];
if (!dependencyRoot) throw new Error('Podaj katalog instalacji @electric-sql/pglite jako pierwszy argument.');
const require = createRequire(resolve(dependencyRoot, 'package.json'));
const { PGlite } = require('@electric-sql/pglite');
const db = new PGlite();
let checks = 0;
const owner = '10000000-0000-0000-0000-000000000001';
const other = '10000000-0000-0000-0000-000000000002';
const client = '20000000-0000-0000-0000-000000000001';
const secondClient = '20000000-0000-0000-0000-000000000002';
const garden = '30000000-0000-0000-0000-000000000001';
const secondGarden = '30000000-0000-0000-0000-000000000002';
const job = '40000000-0000-0000-0000-000000000001';
const hourly = '40000000-0000-0000-0000-000000000002';
const otherJob = '40000000-0000-0000-0000-000000000003';
const p1 = '50000000-0000-0000-0000-000000000001';
const p2 = '50000000-0000-0000-0000-000000000002';
const p3 = '50000000-0000-0000-0000-000000000003';
const p4 = '50000000-0000-0000-0000-000000000004';
const material = '60000000-0000-0000-0000-000000000001';
const session = '70000000-0000-0000-0000-000000000001';
const execute = sql => db.exec(sql);
const query = sql => db.query(sql);
async function value(sql) { const result = await query(sql); return Object.values(result.rows[0])[0]; }
async function check(sql, expected, label) { assert.equal(await value(sql), expected, label); checks++; }
async function rejects(sql, label) { await assert.rejects(() => execute(sql), label); checks++; }
const insert = (id, amount, method = 'transfer', target = job) => `insert into public.payments(id,job_id,amount_cents,received_date,method) values ('${id}','${target}',${amount},'2026-10-29','${method}')`;

try {
  await execute(`create role anon; create role authenticated;
    create schema auth; create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql as
      $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema public, auth to anon, authenticated;
    insert into auth.users values ('${owner}'), ('${other}');`);
  for (const filename of ['202611010001_initial_schema.sql', '202611010002_payments.sql']) {
    await execute(await readFile(new URL(`../migrations/${filename}`, import.meta.url), 'utf8'));
  }
  await execute(`insert into public.clients(id,owner_id,name) values
      ('${client}','${owner}','Klient testowy'), ('${secondClient}','${owner}','Drugi klient');
    insert into public.gardens(id,owner_id,client_id,name) values
      ('${garden}','${owner}','${client}','Ogród pierwszy'),
      ('${secondGarden}','${owner}','${client}','Ogród drugi');
    insert into public.jobs(id,owner_id,garden_id,title,scheduled_date,status,billing,fixed_price) values
      ('${job}','${owner}','${garden}','Ryczałt','2026-10-29','completed','fixed',500),
      ('${hourly}','${owner}','${secondGarden}','Godzinowe','2026-10-29','completed','hourly',0);
    update public.jobs set imported_seconds=3600 where id='${hourly}';`);
  await execute(`set role anon;`);
  await rejects('select * from public.payments', 'Anonymous payment reads are forbidden');
  await execute(`reset role; set role authenticated; select set_config('request.jwt.claim.sub','${owner}',false);`);
  await check(`select count(*)::int from public.payments`, 0, 'Migration invents no payments');
  await check(`select public.job_value_cents('${owner}','${job}')::int`, 50000, 'Fixed price in cents');
  await execute(insert(p1, 20000));
  await check(`select sum(amount_cents)::int from public.payments where job_id='${job}'`, 20000, 'Partial payment');
  await execute(insert(p2, 30000, 'blik'));
  await check(`select sum(amount_cents)::int from public.payments where job_id='${job}'`, 50000, 'Two payments settle one job');
  await check(`select status from public.jobs where id='${job}'`, 'completed', 'Payment does not change work status');
  await rejects(insert(p3, 1), 'Overpayment rejected');
  await rejects(insert(p3, -1), 'Negative payment rejected');
  await rejects(insert(p3, 0), 'Zero payment rejected');
  await rejects(insert(p3, 1, 'card'), 'Unknown method rejected');
  await rejects(`update public.payments set amount_cents=30001 where id='${p2}'`, 'Edited overpayment rejected');
  await execute(`update public.payments set amount_cents=25000, note='Korekta' where id='${p2}'`);
  await check(`select sum(amount_cents)::int from public.payments where job_id='${job}'`, 45000, 'Edit excludes original entry');
  await check(`select revision::int from public.payments where id='${p2}'`, 2, 'Server revision increments');
  await execute(`delete from public.payments where id='${p2}'`);
  await check(`select sum(amount_cents)::int from public.payments where job_id='${job}'`, 20000, 'Delete restores outstanding balance');
  await rejects(`update public.payments set job_id='${hourly}' where id='${p1}'`, 'Payment cannot be moved to another job');
  await rejects(`update public.payments set owner_id='${other}' where id='${p1}'`, 'Payment ownership cannot be changed');
  await rejects(`update public.jobs set fixed_price=199 where id='${job}'`, 'Cannot reduce value below receipts');
  await rejects(`update public.jobs set garden_id='${secondGarden}' where id='${job}'`, 'Paid job cannot change garden');
  await rejects(`update public.gardens set client_id='${secondClient}' where id='${garden}'`, 'Paid garden cannot change client');
  await rejects(`delete from public.jobs where id='${job}'`, 'Paid job cannot be deleted');
  await rejects(`update public.jobs set deleted_at=now() where id='${job}'`, 'Paid job cannot be hidden');
  await execute(`insert into public.materials(id,owner_id,job_id,name,quantity,unit_price)
    values ('${material}','${owner}','${job}','Materiał',1.5,1.05),
    ('60000000-0000-0000-0000-000000000002','${owner}','${job}','Materiał drugi',1.5,1.05);`);
  await check(`select public.job_value_cents('${owner}','${job}')::int`, 50315, 'Legacy aggregate material rounding preserved');
  await execute(insert(p2, 30315));
  await rejects(`delete from public.materials where id='${material}'`, 'Material deletion cannot create overpayment');
  await rejects(`update public.materials set unit_price=0 where id='${material}'`, 'Material price reduction cannot create overpayment');
  await check(`select public.job_value_cents('${owner}','${hourly}')::int`, 12000, 'One-hour labour uses 120 zl rate');
  await execute(`insert into public.work_sessions(id,owner_id,job_id,started_at,ended_at)
    values ('${session}','${owner}','${hourly}','2026-10-29T10:00:00Z','2026-10-29T10:00:01Z');`);
  await check(`select public.job_value_cents('${owner}','${hourly}')::int`, 12003, 'One-second labour rounds once');
  await execute(insert(p3, 12003, 'cash', hourly));
  await rejects(`update public.jobs set imported_seconds=0 where id='${hourly}'`, 'Cannot reduce paid imported time');
  await rejects(`delete from public.work_sessions where id='${session}'`, 'Cannot delete paid time session');
  await execute(`update public.payments set deleted_at=now() where id='${p3}'`);
  await check(`select count(*)::int from public.payments where job_id='${hourly}' and deleted_at is null`, 0, 'Soft delete excludes receipt from balance');
  await execute(`delete from public.work_sessions where id='${session}'`);
  await rejects(`update public.payments set deleted_at=null where id='${p3}'`, 'Restoring payment rechecks balance');
  await execute(`select set_config('request.jwt.claim.sub','${other}',false);`);
  await check(`select count(*)::int from public.payments`, 0, 'Second owner cannot read first owner payments');
  await rejects(insert(p4, 1), 'Second owner cannot add payment to first owner job');
  await check(`with changed as (update public.payments set note='X' where id='${p1}' returning id) select count(*)::int from changed`, 0, 'Second owner cannot update payment');
  await check(`with removed as (delete from public.payments where id='${p1}' returning id) select count(*)::int from removed`, 0, 'Second owner cannot delete payment');
  await execute(`reset role; select set_config('request.jwt.claim.sub','',false); delete from auth.users where id='${owner}';`);
  await check(`select count(*)::int from public.payments`, 0, 'Trusted account removal cascades through ledger');
  console.log(`${checks} SQL/RLS checks passed (embedded PostgreSQL; Auth roles stubbed).`);
} finally {
  await db.close();
}
