const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {PGlite}=require('@electric-sql/pglite');let database,customer;
const profile=(extras={})=>({name:'Test Customer',phone:'+919876543210',serviceInterest:'GCP',timezone:'Asia/Kolkata',stage:'new',notes:'Demo feedback',followUpDate:'2030-02-01',...extras});
const payload=(date,minute=600,duration=60,type='demo')=>({date,startMinute:minute,duration,type,customerId:customer.id,requestId:crypto.randomUUID(),timezone:'Asia/Kolkata',company:'Example',role:'Engineer',round:'L2',notes:''});
async function save(data,id=null){return (await database.query('select public.support_save_customer($1::jsonb,$2::uuid) as customer',[JSON.stringify(data),id])).rows[0].customer;}
async function reserve(data,id=null){return (await database.query('select public.support_reserve($1::jsonb,$2::uuid) as appointment',[JSON.stringify(data),id])).rows[0].appointment;}
async function status(row,value){return (await database.query('select public.support_set_appointment_status($1,$2,$3) as appointment',[row.id,value,row.revision])).rows[0].appointment;}
async function slots(id){return (await database.query('select start_minute from public.support_slot_reservations where appointment_id=$1 order by start_minute',[id])).rows.map(r=>r.start_minute);}
test.before(async()=>{database=new PGlite();await database.exec('create role anon; create role authenticated; create role service_role bypassrls;');await database.exec(fs.readFileSync(path.join(__dirname,'../supabase-schema.sql'),'utf8'));customer=await save(profile());});
test.after(async()=>{if(database)await database.close();});
test('customer PII, appointment data and RPCs are inaccessible to browser roles',async()=>{
  for(const table of ['support_customers','support_appointments','support_slot_reservations','support_booking_requests']){
    const r=(await database.query("select has_table_privilege('anon',$1,'select') as anonymous,has_table_privilege('authenticated',$1,'select') as member,relrowsecurity as rls from pg_class where oid=$1::regclass",['public.'+table])).rows[0];assert.equal(r.anonymous,false);assert.equal(r.member,false);assert.equal(r.rls,true);
  }
  const r=(await database.query("select has_function_privilege('anon','public.support_reserve(jsonb,uuid)','execute') as anonymous,has_function_privilege('service_role','public.support_reserve(jsonb,uuid)','execute') as server")).rows[0];assert.equal(r.anonymous,false);assert.equal(r.server,true);
  await database.exec('set role service_role');assert.equal((await database.query('select count(*) from public.support_customers')).rows.length,1);await database.exec('reset role');
});
test('duplicate formatted phones are rejected; customer edits preserve identity and history',async()=>{
  await assert.rejects(save(profile({phone:'+91 98765 43210'})),{code:'23505'});
  const edited=await save(profile({name:'Updated Customer',stage:'interested',revision:0}),customer.id);assert.equal(edited.id,customer.id);assert.equal(edited.revision,1);assert.equal(edited.follow_up_date,'2030-02-01');
  await assert.rejects(save(profile({revision:0}),customer.id),{code:'40001'});customer=edited;
});
test('demo is exactly one hour; interviews accept 30 or 60 minutes only after interest',async()=>{
  await assert.rejects(reserve(payload('2030-03-01',600,30)),{code:'22023'});
  const uninterested=await save(profile({phone:'+919876543211'}));await assert.rejects(reserve({...payload('2030-03-01',600,30,'interview'),customerId:uninterested.id}),{code:'22023'});
  const demo=await reserve(payload('2030-03-01'));assert.equal(demo.booking_type,'demo');assert.deepEqual(await slots(demo.id),[600,630]);
  const interview=await reserve(payload('2030-03-01',660,30,'interview'));assert.equal(interview.duration_minutes,30);assert.equal(interview.customer_id,demo.customer_id);
});
test('demo and interview share capacity; either half blocks an entire one-hour booking',async()=>{
  await reserve(payload('2030-03-02'));await assert.rejects(reserve(payload('2030-03-02',630,30,'interview')),{code:'23505'});
  await database.query("select public.support_block('2030-03-03',630,'blocked')");await assert.rejects(reserve(payload('2030-03-03')),{code:'23505'});
  assert.equal((await database.query("select count(*)::int as count from public.support_appointments where service_date='2030-03-03'")).rows[0].count,0);
});
test('failed reschedule preserves original slots; successful move atomically replaces them',async()=>{
  const original=await reserve(payload('2030-03-04'));await reserve(payload('2030-03-04',720,30,'interview'));
  await assert.rejects(reserve({...payload('2030-03-04',690),revision:original.revision},original.id),{code:'23505'});assert.deepEqual(await slots(original.id),[600,630]);
  const moved=await reserve({...payload('2030-03-04',630),revision:original.revision},original.id);assert.equal(moved.id,original.id);assert.equal(moved.revision,1);assert.deepEqual(await slots(original.id),[630,660]);
  await assert.rejects(reserve({...payload('2030-03-04',810),revision:0},original.id),{code:'40001'});
});
test('cancel releases the whole reservation, retains history and rejects stale changes',async()=>{
  const original=await reserve(payload('2030-03-05'));await assert.rejects(status({...original,revision:99},'cancelled'),{code:'40001'});
  const cancelled=await status(original,'cancelled');assert.equal(cancelled.status,'cancelled');assert.deepEqual(await slots(original.id),[]);await reserve(payload('2030-03-05'));
});
test('completion and no-show require elapsed time; completion records demo outcome',async()=>{
  const c=await save(profile({phone:'+919876543212'})),a=await reserve({...payload('2030-03-06'),customerId:c.id});
  await assert.rejects(status(a,'completed'),{code:'22023'});await assert.rejects(status(a,'no_show'),{code:'22023'});
  await database.query("update public.support_appointments set starts_at=now()-interval '2 hours',ends_at=now()-interval '1 hour' where id=$1",[a.id]);
  const completed=await status(a,'completed');assert.equal(completed.status,'completed');assert.deepEqual(await slots(a.id),[]);
  assert.equal((await database.query('select stage from public.support_customers where id=$1',[c.id])).rows[0].stage,'demo_completed');
});
test('whole-day blocking covers 40 halves while preserving reserved demos',async()=>{
  const a=await reserve(payload('2030-03-07'));assert.equal((await database.query("select public.support_block('2030-03-07',null,'blocked') as changed")).rows[0].changed,38);
  await assert.rejects(database.query("select public.support_block('2030-03-07',600,'blocked')"),{code:'23505'});
  await database.query("select public.support_block('2030-03-07',null,'available')");assert.deepEqual(await slots(a.id),[600,630]);
  assert.equal((await database.query("select count(*)::int as count from public.support_slot_reservations where service_date='2030-03-07'")).rows[0].count,2);
});
test('request retries remain idempotent after rescheduling; changed retry data is rejected',async()=>{
  const p=payload('2030-03-08'),a=await reserve(p);assert.equal((await reserve(p)).id,a.id);
  const moved=await reserve({...payload('2030-03-08',720),revision:a.revision},a.id);assert.equal((await reserve(p)).id,moved.id);assert.equal((await reserve(p)).start_minute,720);
  await assert.rejects(reserve({...p,startMinute:810}),{code:'22023'});
  assert.equal((await database.query("select count(*)::int as count from public.support_appointments where service_date='2030-03-08'")).rows[0].count,1);
});
test('competing requests have one winner and no partial appointment rows',async()=>{
  const results=await Promise.allSettled([reserve(payload('2030-03-09')),reserve(payload('2030-03-09')),reserve(payload('2030-03-09',630,30,'interview'))]);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
});
test('latest valid starts end at 3 AM and SQL rejects overruns and past times',async()=>{
  const demo=await reserve(payload('2030-12-31',1560));assert.equal(new Date(demo.ends_at).toISOString(),'2030-12-31T21:30:00.000Z');
  const interview=await reserve(payload('2030-12-30',1590,30,'interview'));assert.equal(interview.start_minute,1590);
  await assert.rejects(reserve(payload('2030-12-31',1590)),{code:'22023'});await assert.rejects(reserve(payload('2020-01-01')),{code:'22023'});
});

test('cancelling an interview restores interest even with a demo booked; cancelling demo preserves interview stage',async()=>{
  const c=await save(profile({phone:'+919876543213',stage:'interested'}));
  const demo=await reserve({...payload('2030-04-01'),customerId:c.id});
  const interview=await reserve({...payload('2030-04-01',720,30,'interview'),customerId:c.id});
  await status(interview,'cancelled');assert.equal((await database.query('select stage from public.support_customers where id=$1',[c.id])).rows[0].stage,'interested');
  await reserve({...payload('2030-04-01',720,30,'interview'),customerId:c.id});
  await status(demo,'cancelled');assert.equal((await database.query('select stage from public.support_customers where id=$1',[c.id])).rows[0].stage,'interview_booked');
});
