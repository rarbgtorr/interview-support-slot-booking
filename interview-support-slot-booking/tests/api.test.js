'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const H=require('../netlify/functions/_shared');
process.env.SUPABASE_URL='https://test.supabase.co';process.env.SUPABASE_PUBLISHABLE_KEY='sb_publishable_test';process.env.SUPABASE_SECRET_KEY='sb_secret_test';
process.env.ADMIN_PASSWORD='test-admin-password';process.env.ADMIN_JWT_SECRET='test-admin-secret-with-more-than-32-characters';
const input=()=>({date:'2030-01-01',startMinute:600,duration:60,timezone:'America/New_York',requestId:crypto.randomUUID(),name:'Member',email:'member@example.com',phone:'+919876543210',interviewRole:'GCP Engineer'});
const event=(method='POST',payload={},token)=>({httpMethod:method,headers:token?{authorization:'Bearer '+token}:{},body:JSON.stringify(payload),queryStringParameters:{month:'2030-01'}});
const json=value=>new Response(JSON.stringify(value),{status:200,headers:{'Content-Type':'application/json'}});
test('anonymous availability exposes only statuses, never customer details',async t=>{
  t.mock.method(global,'fetch',async()=>json([{service_date:'2030-01-01',start_minute:600,kind:'booked'}]));
  const result=await require('../netlify/functions/slots').handler(event('GET'));assert.equal(result.statusCode,200);assert.deepEqual(JSON.parse(result.body),{'2030-01-01':{'600':'booked'}});assert.ok(!result.body.includes('email'));
});
test('all admin mutation and read endpoints reject anonymous access without querying DB',async t=>{
  let calls=0;t.mock.method(global,'fetch',async()=>{calls++;return json({});});
  for(const path of ['admin-slots','admin-block','admin-release','visitor-stats']){const result=await require('../netlify/functions/'+path).handler(event(['admin-slots','visitor-stats'].includes(path)?'GET':'POST'));assert.equal(result.statusCode,401);}
  assert.equal(calls,0);
});
test('admin token validates signature, audience and expiry',async()=>{
  const signed=H.signAdmin();assert.doesNotThrow(()=>H.admin(event('GET',{},signed)));
  assert.throws(()=>H.admin(event('GET',{},signed.slice(0,-8)+'xxxxxxxx')),/administrator/);
  const [head]=signed.split('.');const payload=Buffer.from(JSON.stringify({aud:'interview-support-admin',scope:'admin',exp:1})).toString('base64url');const body=head+'.'+payload;const expired=body+'.'+crypto.createHmac('sha256',process.env.ADMIN_JWT_SECRET).update(body).digest('base64url');
  assert.throws(()=>H.admin(event('GET',{},expired)),/administrator/);
});
test('booking submits both slots through one atomic RPC and ignores forged local labels',async t=>{
  const calls=[];const payload={...input(),customerSlot:'forged'};
  t.mock.method(global,'fetch',async(url,options)=>{calls.push({url:String(url),body:JSON.parse(options.body)});return json({id:crypto.randomUUID(),service_date:payload.date,start_minute:600,duration_minutes:60,interview_role:'GCP Engineer',customer_timezone:payload.timezone,replayed:false});});
  const result=await require('../netlify/functions/book').handler(event('POST',payload));assert.equal(result.statusCode,200);assert.equal(calls.length,1);assert.match(calls[0].url,/rpc\/interview_reserve/);assert.equal(calls[0].body.p_data.duration,60);assert.ok(!('customerSlot' in calls[0].body.p_data));assert.equal(JSON.parse(result.body).notifications.member,false);
});
test('conflict is 409, and malformed selections never reach the database',async t=>{
  let calls=0;t.mock.method(global,'fetch',async()=>{calls++;return new Response(JSON.stringify({code:'23505',message:'Conflict'}),{status:409});});
  const handler=require('../netlify/functions/book').handler;
  assert.equal((await handler(event('POST',input()))).statusCode,409);
  for(const payload of [{...input(),startMinute:1530},{...input(),duration:90},{...input(),timezone:'invalid'},{...input(),date:'2030-02-30'},{...input(),phone:'abc'}])assert.equal((await handler(event('POST',payload))).statusCode,400);
  assert.equal(calls,1);
});
test('member endpoints require a verified email, not just a client-provided identity',async t=>{
  for(const path of ['member-bookings','member-cancel','member-reschedule'])assert.equal((await require('../netlify/functions/'+path).handler(event(path==='member-bookings'?'GET':'POST'))).statusCode,401);
  t.mock.method(global,'fetch',async()=>json({id:crypto.randomUUID(),email:'member@example.com'}));
  assert.equal((await require('../netlify/functions/member-bookings').handler(event('GET',{},'unconfirmed'))).statusCode,401);
});
test('member list and cancellation are scoped to server-verified email',async t=>{
  const calls=[];t.mock.method(global,'fetch',async(url,options)=>{
    calls.push({url:String(url),body:options.body&&JSON.parse(options.body)});
    if(String(url).includes('/auth/'))return json({id:'user',email:'Member@Example.com',email_confirmed_at:'2026-01-01'});
    return json(String(url).includes('/rpc/')?{id:crypto.randomUUID(),email:'member@example.com',service_date:'2030-01-01',start_minute:600,duration_minutes:60,customer_timezone:'Asia/Kolkata',interview_role:'GCP Engineer'}:[]);
  });
  assert.equal((await require('../netlify/functions/member-bookings').handler(event('GET',{},'valid'))).statusCode,200);
  assert.equal(new URL(calls[1].url).searchParams.get('email'),'eq.member@example.com');calls.length=0;
  assert.equal((await require('../netlify/functions/member-cancel').handler(event('POST',{id:crypto.randomUUID(),email:'other@example.com'},'valid'))).statusCode,200);
  assert.equal(calls[1].body.p_email,'member@example.com');assert.match(calls[1].url,/rpc\/interview_cancel/);
});
test('rescheduling cannot change ownership and uses a single atomic RPC',async t=>{
  const calls=[];t.mock.method(global,'fetch',async(url,options)=>{calls.push({url:String(url),body:options.body&&JSON.parse(options.body)});if(String(url).includes('/auth/'))return json({id:'user',email:'member@example.com',email_confirmed_at:'2026-01-01'});return json({id:crypto.randomUUID(),email:'member@example.com',replayed:true});});
  const handler=require('../netlify/functions/member-reschedule').handler;
  const payload={...input(),id:crypto.randomUUID()};assert.equal((await handler(event('POST',{...payload,email:'someone@example.com'},'valid'))).statusCode,403);
  calls.length=0;assert.equal((await handler(event('POST',payload,'valid'))).statusCode,200);assert.equal(calls.length,2);assert.equal(calls[1].body.p_booking_id,payload.id);assert.equal(calls[1].body.p_email,'member@example.com');
});
test('client configuration never returns a server secret',async()=>{
  const key=process.env.SUPABASE_PUBLISHABLE_KEY;process.env.SUPABASE_PUBLISHABLE_KEY='sb_secret_bad';
  assert.equal((await require('../netlify/functions/member-config').handler(event('GET'))).statusCode,503);process.env.SUPABASE_PUBLISHABLE_KEY=key;
});
