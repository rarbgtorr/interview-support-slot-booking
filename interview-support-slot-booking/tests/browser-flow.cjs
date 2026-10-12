'use strict';
// Optional end-to-end check: Playwright + Chromium, real handlers, real schema in isolated PGlite.
const {chromium}=require('playwright'),{PGlite}=require('@electric-sql/pglite');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{spawn}=require('node:child_process');
const root=path.resolve(__dirname,'..');let server,browser,database;
process.env.SUPABASE_URL='https://qa.supabase.co';process.env.SUPABASE_SECRET_KEY='sb_secret_qa';
delete process.env.ADMIN_PASSWORD;delete process.env.ADMIN_JWT_SECRET;
const actualFetch=global.fetch;
(async()=>{
 database=new PGlite();await database.exec('create role anon; create role authenticated; create role service_role bypassrls;');await database.exec(fs.readFileSync(path.join(root,'supabase-schema.sql'),'utf8'));
 // Only Supabase's HTTP transport is adapted; SQL, RPCs, handlers and browser actions are real.
 global.fetch=async(url,options={})=>{
  const u=new URL(url);if(u.host!=='qa.supabase.co')return actualFetch(url,options);
  try{let result;const resource=u.pathname.replace('/rest/v1/','');
   if(resource.startsWith('rpc/')){const name=resource.slice(4);assert.match(name,/^support_[a-z_]+$/);const payload=JSON.parse(options.body);const entries=Object.entries(payload);const values=entries.map(([k,v])=>k==='p_data'?JSON.stringify(v):v);const placeholders=entries.map(([k],i)=>k+' => $'+(i+1)+(k==='p_data'?'::jsonb':''));result=(await database.query('select public.'+name+'('+placeholders.join(',')+') as result',values)).rows[0].result;}
   else{assert.ok(['support_customers','support_appointments','support_slot_reservations'].includes(resource));const limit=Number(u.searchParams.get('limit')||1000),offset=Number(u.searchParams.get('offset')||0);let query='select '+(u.searchParams.get('select')?.includes('customer:')?"to_jsonb(t)||jsonb_build_object('customer',(select to_jsonb(c) from public.support_customers c where c.id=t.customer_id))":'to_jsonb(t)')+' as row from public.'+resource+' t',values=[];if(u.searchParams.has('service_date')){values=[u.searchParams.get('service_date').slice(4),u.searchParams.get('and').match(/lt\.([^)]*)/)[1]];query+=' where service_date >= $1::date and service_date < $2::date'+(u.searchParams.get('status')==='neq.cancelled'?" and status <> 'cancelled'":'')+' order by service_date,start_minute';}else query+=' order by created_at,id';query+=' limit '+limit+' offset '+offset;result=(await database.query(query,values)).rows.map(r=>r.row);}
   return new Response(JSON.stringify(result),{status:200});
  }catch(e){return new Response(JSON.stringify({code:e.code||'DB_ERROR',message:e.message}),{status:400});}
 };
 server=spawn(process.execPath,[path.join(root,'scripts/dev.js')],{env:{...process.env,PORT:'3018'}});await new Promise((resolve,reject)=>{server.stdout.once('data',resolve);server.once('error',reject);});
 const args=['--no-sandbox','--disable-dev-shm-usage','--single-process','--no-zygote'];
 browser=await chromium.launch({headless:true,args,...(process.env.QA_CHROMIUM_EXECUTABLE?{executablePath:process.env.QA_CHROMIUM_EXECUTABLE}:{})});
 const page=await browser.newPage({viewport:{width:390,height:844},timezoneId:'Asia/Kolkata'});const errors=[];page.on('pageerror',e=>{errors.push(e.message);console.error('Browser error:',e.message);});
 await page.clock.install({time:new Date('2030-01-01T06:00:00+05:30')});
 let lastBooking;
 await page.route('**/.netlify/functions/**',async route=>{
  const request=route.request(),u=new URL(request.url()),name=u.pathname.split('/').pop();const event={httpMethod:request.method(),headers:request.headers(),body:request.postData()||'',queryStringParameters:Object.fromEntries(u.searchParams)};
  const result=await require(path.join(root,'netlify/functions',name+'.js')).handler(event);if(name==='admin-appointments'&&result.statusCode===200)lastBooking=JSON.parse(result.body).appointment;
  await route.fulfill({status:result.statusCode,headers:result.headers,body:result.body});
 });
 page.on('dialog',d=>d.accept());
 await page.goto('http://localhost:3018/');assert.equal(await page.locator('input[type=password]').count(),0);await page.waitForSelector('#slotGrid .slot-box');
 const tile=m=>page.locator('#slotGrid [data-minute="'+m+'"]');
 async function fillBooking(type,name,phone){await page.selectOption('#bookingType',type);await page.fill('#memberName',name);await page.fill('#whatsapp',phone);await page.fill('#company','Example Company');await page.fill('#experience','5 years');await page.fill('#interviewStage',type==='demo'?'Demo':'Technical L2');}
 async function save(){await page.click('#saveBooking');await page.waitForFunction(()=>!document.getElementById('bookingDialog').open);await page.waitForFunction(()=>document.getElementById('message').textContent.includes('Booking'));}
 await tile(600).click();await fillBooking('demo','First member','+919876543210');await page.selectOption('#memberTimezone','America/New_York');assert.match(await page.locator('#selectedTime').innerText(),/10:00 am.*10:30 am/i);await save();assert.equal(lastBooking.start_minute,600);assert.equal(lastBooking.duration_minutes,30);const firstId=lastBooking.id;
 assert.match(await tile(570).innerText(),/Available.*0\/2/);assert.match(await tile(630).innerText(),/Available.*0\/2/);assert.match(await tile(600).innerText(),/Booked.*1\/2/);
 await tile(600).click();assert.equal(await page.locator('#slotBookings .booking-card').count(),1);await page.click('#addAnother');await fillBooking('interview','Second member','+919876543211');await save();assert.equal(lastBooking.start_minute,600);const secondId=lastBooking.id;assert.match(await tile(600).getAttribute('class'),/mixed/);assert.match(await tile(600).innerText(),/Full.*2\/2/);
 await tile(600).click();assert.equal(await page.locator('#slotBookings .booking-card').count(),2);assert.equal(await page.locator('#addAnother').isVisible(),false);await page.locator('#slotBookings .booking-card').filter({hasText:'First member'}).getByRole('button',{name:'Reschedule'}).click();await tile(630).click();assert.equal(await page.locator('#memberName').inputValue(),'First member');assert.equal(await page.locator('#memberTimezone').inputValue(),'America/New_York');await save();assert.equal(lastBooking.id,firstId);assert.equal(lastBooking.start_minute,630);assert.match(await tile(600).innerText(),/Booked.*1\/2/);assert.match(await tile(630).innerText(),/First member/);
 await tile(600).click();await page.click('#addAnother');await fillBooking('interview','Third member','+919876543212');await save();assert.match(await tile(600).innerText(),/Full.*2\/2/);await tile(600).click();await page.locator('#slotBookings .booking-card').filter({hasText:'Second member'}).getByRole('button',{name:'Cancel booking'}).click();await page.waitForFunction(()=>document.getElementById('message').textContent.includes('Booking cancelled'));assert.match(await tile(600).innerText(),/Booked.*1\/2/);
 const screenDir=process.env.QA_SCREENSHOT_DIR;if(screenDir){fs.mkdirSync(screenDir,{recursive:true});await page.screenshot({path:path.join(screenDir,'simple-mobile.png'),fullPage:true});}

 // Check actual rendered booking colors in both device themes, including member pills.
 for(const colorScheme of ['light','dark']){
  await page.emulateMedia({colorScheme});await page.setViewportSize({width:390,height:844});
  const ratios=await page.evaluate(()=>{
   const rgb=value=>value.match(/[\d.]+/g).slice(0,3).map(Number);
   const lum=value=>rgb(value).map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4;}).reduce((n,v,i)=>n+v*[.2126,.7152,.0722][i],0);
   const contrast=(a,b)=>{const x=lum(a),y=lum(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05);};
   return [...document.querySelectorAll('.slot-box.demo,.slot-box.interview')].flatMap(box=>{
    const bg=getComputedStyle(box).backgroundColor;
    return [...box.querySelectorAll('.slot-time,.slot-count,.member-pill')].map(node=>{const style=getComputedStyle(node);return {label:node.className,ratio:contrast(style.color,node.classList.contains('member-pill')?style.backgroundColor:bg)};});
   });
  });
  assert.ok(ratios.length>0);for(const r of ratios)assert.ok(r.ratio>=4.5,colorScheme+' '+r.label+' contrast: '+r.ratio);
  if(screenDir)await page.screenshot({path:path.join(screenDir,colorScheme+'-mobile.png'),fullPage:true});
  await tile(600).click();if(screenDir)await page.screenshot({path:path.join(screenDir,colorScheme+'-details.png')});await page.locator('[data-close="slotDialog"]').click();
  await tile(660).click();if(screenDir)await page.screenshot({path:path.join(screenDir,colorScheme+'-form.png')});await page.locator('[data-close="bookingDialog"]').click();
  for(const width of [320,390,1440]){await page.setViewportSize({width,height:900});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);}
 }
 await page.emulateMedia({colorScheme:'light'});
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await page.setViewportSize({width:320,height:740});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await page.setViewportSize({width:1440,height:1000});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 await page.getByRole('tab',{name:'Night',exact:true}).click();assert.equal(await page.locator('#slotGrid .slot-box').count(),12);assert.match(await tile(1590).innerText(),/2:30 am.*3:00 am/i);await tile(1590).click();assert.match(await page.locator('#selectedTime').innerText(),/2 Jan 2030/);await page.locator('[data-close="bookingDialog"]').click();
 const rows=(await database.query('select start_minute from public.support_slot_reservations where appointment_id=$1',[firstId])).rows;assert.deepEqual(rows.map(r=>r.start_minute),[630]);assert.equal((await database.query('select count(*)::int as n from public.support_slot_reservations where appointment_id=$1',[secondId])).rows[0].n,0);
 assert.equal(errors.length,0,errors.join('\n'));assert.equal((await page.goto('http://localhost:3018/booking')).status(),404);
 console.log('Browser flow passed: no password or session, light/dark contrast >=4.5:1, exact 30-minute boxes, six fields, demo/interview colours, two bookings, reschedule release, cancel isolation, timezone, 320/390/1440px layouts, and no extra pages.');
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(async()=>{global.fetch=actualFetch;if(browser)await browser.close();if(server)server.kill();if(database)await database.close();});
