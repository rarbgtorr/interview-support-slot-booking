const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto'),fs=require('node:fs');
const H=require('../netlify/functions/_shared');
process.env.SUPABASE_URL='https://test.supabase.co';process.env.SUPABASE_SECRET_KEY='sb_secret_test';process.env.ADMIN_PASSWORD='test-admin-password';process.env.ADMIN_JWT_SECRET='test-admin-secret-with-more-than-32-characters';
const id=()=>crypto.randomUUID(),input=()=>({date:'2030-01-01',startMinute:600,duration:60,type:'demo',customerId:id(),requestId:id(),timezone:'Asia/Kolkata',notes:''});
const event=(method='POST',payload={},signed=H.signAdmin())=>({httpMethod:method,headers:signed?{authorization:'Bearer '+signed}:{},body:JSON.stringify(payload),queryStringParameters:{month:'2030-01'}});
const json=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json'}});
test('all customer, appointment and availability endpoints require admin before DB access',async t=>{
  let calls=0;t.mock.method(global,'fetch',async()=>{calls++;return json({});});
  for(const [path,method] of [['admin-data','GET'],['admin-customers','POST'],['admin-appointments','POST'],['admin-appointment-status','POST'],['admin-block','POST'],['admin-slots','GET']])assert.equal((await require('../netlify/functions/'+path).handler(event(method,{},null))).statusCode,401);
  assert.equal(calls,0);
});
test('admin login and token require correct password, signature, audience and expiry',async()=>{
  const login=require('../netlify/functions/admin-login').handler;assert.equal((await login(event('POST',{password:'wrong'},null))).statusCode,401);assert.equal((await login(event('POST',{password:process.env.ADMIN_PASSWORD},null))).statusCode,200);
  const signed=H.signAdmin();assert.doesNotThrow(()=>H.admin(event('GET',{},signed)));assert.throws(()=>H.admin(event('GET',{},signed.slice(0,-8)+'xxxxxxxx')),/administrator/);
  for(const p of [{aud:'wrong',scope:'admin',exp:Date.now()/1000+1000},{aud:'interview-support-admin',scope:'admin',exp:1}]){const head=signed.split('.')[0],body=head+'.'+Buffer.from(JSON.stringify(p)).toString('base64url');assert.throws(()=>H.admin(event('GET',{},body+'.'+crypto.createHmac('sha256',process.env.ADMIN_JWT_SECRET).update(body).digest('base64url'))),/administrator/);}
});
test('appointment uses a single atomic RPC, and never sends email',async t=>{
  const calls=[];t.mock.method(global,'fetch',async(url,options)=>{calls.push({url:String(url),body:JSON.parse(options.body),headers:options.headers});return json({id:id()});});
  const payload=input(),r=await require('../netlify/functions/admin-appointments').handler(event('POST',{...payload,forgedLabel:'fake'}));assert.equal(r.statusCode,200);assert.equal(calls.length,1);assert.match(calls[0].url,/rpc\/support_reserve/);assert.equal(calls[0].body.p_data.duration,60);assert.ok(!('forgedLabel' in calls[0].body.p_data));assert.equal(calls[0].headers.apikey,'sb_secret_test');assert.equal(calls[0].headers.Authorization,undefined);assert.ok(!r.body.includes('notifications'));
});
test('wrong demo duration, closing overrun, unsupported zone and malformed IDs are rejected before RPC',async t=>{
  let calls=0;t.mock.method(global,'fetch',async()=>{calls++;return json({});});const h=require('../netlify/functions/admin-appointments').handler;
  for(const p of [{...input(),duration:30},{...input(),startMinute:1590},{...input(),duration:90},{...input(),timezone:'bad'},{...input(),date:'2030-02-30'},{...input(),customerId:'bad'},{...input(),id:id(),revision:-1}])assert.equal((await h(event('POST',p))).statusCode,400);assert.equal(calls,0);
});
test('conflicts and stale records return 409 with useful messages',async t=>{
  const h=require('../netlify/functions/admin-appointments').handler;t.mock.method(global,'fetch',async()=>json({code:'23505',message:'Slot unavailable'},409));assert.equal((await h(event('POST',input()))).statusCode,409);
  t.mock.method(global,'fetch',async()=>json({code:'40001',message:'Stale'},409));assert.match((await h(event('POST',input()))).body,/Refresh/i);
});
test('customers save without email and reject invalid phones and follow-up dates',async t=>{
  let call;t.mock.method(global,'fetch',async(url,options)=>{call={url:String(url),body:JSON.parse(options.body)};return json({id:id()});});
  const p={name:'Customer',phone:'+919876543210',timezone:'Asia/Kolkata',stage:'interested',followUpDate:'2030-01-01'};const h=require('../netlify/functions/admin-customers').handler;
  assert.equal((await h(event('POST',p))).statusCode,200);assert.match(call.url,/support_save_customer/);assert.ok(!('email' in call.body.p_data));
  for(const bad of [{...p,phone:'abc'},{...p,followUpDate:'2030-02-30'},{...p,stage:'bad'}])assert.equal((await h(event('POST',bad))).statusCode,400);
});
test('customer data paging retrieves records beyond Supabase response cap',async t=>{
  const requests=[];t.mock.method(global,'fetch',async(url)=>{const u=new URL(url);requests.push(u);const offset=Number(u.searchParams.get('offset'));return json(offset===0?Array.from({length:1000},()=>({id:id()})):[{id:'last'}]);});
  const r=await require('../netlify/functions/admin-data').handler(event('GET'));assert.equal(r.statusCode,200);assert.equal(JSON.parse(r.body).customers.length,1001);assert.equal(JSON.parse(r.body).appointments.length,1001);assert.equal(requests.length,4);
});
test('month availability paging retrieves all 1240 possible half-hours',async t=>{
  const requests=[];t.mock.method(global,'fetch',async(url)=>{const u=new URL(url);requests.push(u);const offset=Number(u.searchParams.get('offset'));return json(Array.from({length:offset===0?1000:240},(_,i)=>{const n=offset+i;return {service_date:'2030-01-'+String(Math.floor(n/40)+1).padStart(2,'0'),start_minute:420+n%40*30,kind:'blocked',appointment_id:null};}));});
  const r=await require('../netlify/functions/admin-slots').handler(event('GET'));assert.equal(Object.values(JSON.parse(r.body).days).flatMap(Object.values).length,1240);assert.equal(requests.length,2);
});
test('member, public booking and email functions are removed',()=>{
  for(const name of ['book','slots','member-config','member-bookings','member-cancel','member-reschedule','reminders','visitor-track'])assert.equal(fs.existsSync(__dirname+'/../netlify/functions/'+name+'.js'),false);
  assert.equal(fs.existsSync(__dirname+'/../public/member.html'),false);assert.equal(H.notify,undefined);assert.equal(H.member,undefined);
});
