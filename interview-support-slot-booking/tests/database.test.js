'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {PGlite}=require('@electric-sql/pglite');
let database;
test.before(async()=>{
  database=new PGlite();
  await database.exec('create role anon; create role authenticated; create role service_role bypassrls;');
  await database.exec(fs.readFileSync(path.join(__dirname,'../supabase-schema.sql'),'utf8'));
});
test.after(async()=>{if(database)await database.close();});
const payload=(date,minute=600,duration=60,email='member@example.com')=>({date,startMinute:minute,duration,timezone:'Asia/Kolkata',requestId:crypto.randomUUID(),name:'Member',email,phone:'+919876543210',interviewRole:'GCP Engineer'});
async function reserve(data,email=null,id=null){return (await database.query('select public.interview_reserve($1::jsonb,$2::text,$3::uuid) as booking',[JSON.stringify(data),email,id])).rows[0].booking;}
test('SQL installs: public users cannot read PII or execute privileged RPCs',async()=>{
  const privileges=(await database.query("select has_table_privilege('anon','public.interview_bookings','select') as table_access, has_function_privilege('authenticated','public.interview_reserve(jsonb,text,uuid)','execute') as rpc_access,has_function_privilege('service_role','public.interview_reserve(jsonb,text,uuid)','execute') as service_access")).rows[0];
  assert.equal(privileges.table_access,false);assert.equal(privileges.rpc_access,false);assert.equal(privileges.service_access,true);
});
test('60-minute booking owns two halves; overlapping bookings conflict',async()=>{
  const row=await reserve(payload('2030-02-01'));
  const slots=(await database.query('select start_minute from public.interview_slot_reservations where booking_id=$1 order by start_minute',[row.id])).rows;
  assert.deepEqual(slots.map(r=>r.start_minute),[600,630]);
  await assert.rejects(reserve(payload('2030-02-01',630,30)),{code:'23505'});
  await assert.rejects(reserve(payload('2030-02-01',570,60)),{code:'23505'});
});
test('blocking either half rejects the complete booking without partial insertion',async()=>{
  await database.query("select public.interview_block('2030-02-02',630,'blocked')");
  await assert.rejects(reserve(payload('2030-02-02')),{code:'23505'});
  const count=(await database.query("select count(*)::int as count from public.interview_bookings where service_date='2030-02-02'")).rows[0].count;
  assert.equal(count,0);
});
test('cancel releases both halves; verified email cannot cancel someone else',async()=>{
  const row=await reserve(payload('2030-02-03'));
  await assert.rejects(database.query('select public.interview_cancel($1,$2)',[row.id,'other@example.com']),{code:'P0002'});
  await database.query('select public.interview_cancel($1,$2)',[row.id,row.email]);
  assert.equal((await database.query('select count(*)::int as count from public.interview_slot_reservations where booking_id=$1',[row.id])).rows[0].count,0);
  const replacement=await reserve(payload('2030-02-03'));assert.notEqual(replacement.id,row.id);
});
test('failed reschedule preserves original reservation, successful move is atomic',async()=>{
  const old=await reserve(payload('2030-02-04'));
  await reserve(payload('2030-02-04',720,30,'other@example.com'));
  await assert.rejects(reserve(payload('2030-02-04',690,60),old.email,old.id),{code:'23505'});
  const before=(await database.query('select start_minute from public.interview_slot_reservations where booking_id=$1 order by start_minute',[old.id])).rows;
  assert.deepEqual(before.map(r=>r.start_minute),[600,630]);
  const moved=await reserve(payload('2030-02-04',1410,60),old.email,old.id);assert.equal(moved.id,old.id);assert.equal(moved.revision,1);
  const after=(await database.query('select start_minute from public.interview_slot_reservations where booking_id=$1 order by start_minute',[old.id])).rows;
  assert.deepEqual(after.map(r=>r.start_minute),[1410,1440]);
});
test('reschedule can overlap its own previous halves while excluding other bookings',async()=>{
  const old=await reserve(payload('2030-02-05'));
  const moved=await reserve(payload('2030-02-05',630,60),old.email,old.id);assert.equal(moved.start_minute,630);
});
test('admin whole-day blocking preserves bookings and unblocking removes only blocks',async()=>{
  const row=await reserve(payload('2030-02-06'));
  const blocked=(await database.query("select public.interview_block('2030-02-06',null,'blocked') as changed")).rows[0].changed;
  assert.equal(blocked,36);
  await assert.rejects(database.query("select public.interview_block('2030-02-06',600,'blocked')"),{code:'23505'});
  await database.query("select public.interview_block('2030-02-06',null,'available')");
  const count=(await database.query("select count(*)::int as count from public.interview_slot_reservations where service_date='2030-02-06'")).rows[0].count;
  assert.equal(count,2);assert.ok(row.id);
});
test('request retry is idempotent and concurrent competing requests have one winner',async()=>{
  const data=payload('2030-02-07'),first=await reserve(data),second=await reserve(data);assert.equal(first.id,second.id);assert.equal(second.replayed,true);
  const results=await Promise.allSettled([reserve(payload('2030-02-08')),reserve(payload('2030-02-08')),reserve(payload('2030-02-08',630,30))]);
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
});
test('SQL rejects closing overrun and past slots and stores actual next-day timestamps',async()=>{
  await assert.rejects(reserve(payload('2030-02-09',1530,60)),{code:'22023'});
  await assert.rejects(reserve(payload('2020-02-09',600,30)),{code:'22023'});
  const row=await reserve(payload('2030-12-31',1500,60));
  assert.equal(new Date(row.starts_at).toISOString(),'2030-12-31T19:30:00.000Z');
  assert.equal(new Date(row.ends_at).toISOString(),'2030-12-31T20:30:00.000Z');
});
