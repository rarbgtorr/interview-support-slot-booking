'use strict';
const crypto=require('node:crypto');
const S=require('../../public/schedule');
class HttpError extends Error { constructor(status,message){super(message);this.status=status;} }
class DatabaseError extends Error { constructor(code,message){super(message);this.code=code;} }
function response(status,body){return {statusCode:status,headers:{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'},body:JSON.stringify(body)};}
function body(event){try{if((event.body||'').length>12000)throw new Error();const parsed=JSON.parse(event.body||'{}');if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))throw new Error();return parsed;}catch{throw new HttpError(400,'Invalid request body.');}}
function bearer(event){return String(event.headers?.authorization||event.headers?.Authorization||'').replace(/^Bearer\s+/i,'').trim();}
function secret(){const value=process.env.ADMIN_JWT_SECRET;if(!value||value.length<32)throw new HttpError(503,'Administrator login is not configured.');return value;}
function signAdmin(){const head=Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url');const payload=Buffer.from(JSON.stringify({aud:'interview-support-admin',scope:'admin',exp:Math.floor(Date.now()/1000)+28800})).toString('base64url');const signed=head+'.'+payload;return signed+'.'+crypto.createHmac('sha256',secret()).update(signed).digest('base64url');}
function admin(event){
  try{const [head,payload,signature,...extra]=bearer(event).split('.');if(extra.length||!head||!payload||!signature)throw new Error();const expected=crypto.createHmac('sha256',secret()).update(head+'.'+payload).digest();const received=Buffer.from(signature,'base64url');if(received.length!==expected.length||!crypto.timingSafeEqual(expected,received))throw new Error();const h=JSON.parse(Buffer.from(head,'base64url'));const p=JSON.parse(Buffer.from(payload,'base64url'));if(h.alg!=='HS256'||p.aud!=='interview-support-admin'||p.scope!=='admin'||!Number.isFinite(p.exp)||p.exp<=Date.now()/1000)throw new Error();}catch{throw new HttpError(401,'Please log in as administrator.');}
}
async function member(event){
  const token=bearer(event);if(!token)throw new HttpError(401,'Please log in to manage your bookings.');
  const key=process.env.SUPABASE_PUBLISHABLE_KEY||process.env.SUPABASE_ANON_KEY;
  if(!process.env.SUPABASE_URL||!key)throw new HttpError(503,'Member login is not configured.');
  const result=await fetch(process.env.SUPABASE_URL.replace(/\/$/,'')+'/auth/v1/user',{headers:{apikey:key,Authorization:'Bearer '+token},signal:AbortSignal.timeout(15000)});
  if(!result.ok)throw new HttpError(401,'Your login has expired. Please sign in again.');
  const user=await result.json();
  if(!user.id||!user.email||!user.email_confirmed_at)throw new HttpError(401,'Please verify your email to manage bookings.');
  return {id:user.id,email:user.email.trim().toLowerCase()};
}
async function db(path,{method='GET',query,body:payload}={}){
  const url=process.env.SUPABASE_URL,key=process.env.SUPABASE_SECRET_KEY||process.env.SUPABASE_SERVICE_ROLE_KEY;
  if(!url||!key)throw new HttpError(503,'Booking service is not configured yet.');
  const endpoint=new URL(url.replace(/\/$/,'')+'/rest/v1/'+path);
  if(query)for(const [name,value] of Object.entries(query))endpoint.searchParams.set(name,value);
  const headers={apikey:key,'Content-Type':'application/json',Prefer:'return=representation'};
  if(key.startsWith('eyJ'))headers.Authorization='Bearer '+key;
  const result=await fetch(endpoint,{method,headers,body:payload===undefined?undefined:JSON.stringify(payload),signal:AbortSignal.timeout(20000)});
  const text=await result.text();let data;try{data=text?JSON.parse(text):null;}catch{throw new HttpError(502,'Booking service returned an invalid response.');}
  if(!result.ok)throw new DatabaseError(data?.code||'DB_ERROR',data?.message||'Database request failed');
  return data;
}
const rpc=(name,payload)=>db('rpc/'+name,{method:'POST',body:payload});
function wrap(method,handler,adminRequired=false){return async event=>{
  try{if(event.httpMethod!==method)return response(405,{error:'Method not allowed.'});if(adminRequired)admin(event);return await handler(event);}
  catch(error){if(error instanceof HttpError)return response(error.status,{error:error.message});
    const code=error.code;
    if(code==='23505')return response(409,{error:'That time is no longer available. Please choose another slot.'});
    if(code==='22023'||code==='22007'||code==='22P02'||code==='23514'||code==='23502')return response(400,{error:'Invalid booking details or a time that has already passed.'});
    if(code==='P0002')return response(404,{error:'Booking not found or no longer available to manage.'});
    if(code==='42501')return response(403,{error:'You do not have access to this booking, or the database permissions need configuration.'});
    console.error('Booking request failed:',code||error.name);return response(500,{error:'Unable to complete this request. Please try again.'});}
};}
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function bookingId(value){if(typeof value!=='string'||!UUID.test(value))throw new HttpError(400,'A valid booking ID is required.');return value;}
function validateBooking(input){
  if(!S.validSelection(input.date,input.startMinute,input.duration))throw new HttpError(400,'Select a future 30- or 60-minute slot within operating hours.');
  if(!S.validZone(input.timezone))throw new HttpError(400,'Select a valid timezone.');
  bookingId(input.requestId);
  const limits={name:100,email:254,phone:30,interviewRole:150,company:150,interviewRound:100,notes:1000};
  const result={date:input.date,startMinute:input.startMinute,duration:input.duration,timezone:input.timezone,requestId:input.requestId};
  for(const [field,limit] of Object.entries(limits)){
    const value=input[field]??'';if(typeof value!=='string'||value.length>limit)throw new HttpError(400,'Please check your '+field+' field.');result[field]=value.trim();
  }
  result.email=result.email.toLowerCase();
  if(!result.name||!result.interviewRole||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(result.email)||!/^[+()\d\s-]{7,30}$/.test(result.phone)||result.phone.replace(/\D/g,'').length<7)throw new HttpError(400,'Enter your name, interview role, valid email and WhatsApp number.');
  return result;
}
function monthRange(month){if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month||''))throw new HttpError(400,'Select a valid month.');const from=month+'-01';if(!S.validDate(from))throw new HttpError(400,'Invalid month.');const [year,m]=month.split('-').map(Number);const next=new Date(Date.UTC(year,m,1)).toISOString().slice(0,10);return {from,next};}
const rowFields='id,service_date,start_minute,duration_minutes,starts_at,ends_at,name,email,phone,interview_role,company,interview_round,notes,customer_timezone,status,revision,created_at';
function publicBooking(row){return Object.fromEntries(rowFields.split(',').map(key=>[key,row[key]]));}
let mailer;
async function sendEmail(to,subject,text){
  if(!process.env.GMAIL_USER||!process.env.GMAIL_APP_PASSWORD)return false;
  if(!mailer)mailer=require('nodemailer').createTransport({host:'smtp.gmail.com',port:465,secure:true,connectionTimeout:10000,greetingTimeout:10000,socketTimeout:15000,auth:{user:process.env.GMAIL_USER,pass:process.env.GMAIL_APP_PASSWORD}});
  await mailer.sendMail({from:{name:'Interview Support',address:process.env.GMAIL_USER},to,subject,text});return true;
}
async function notify(booking,kind='confirmed'){
  const memberTime=S.localLabel(booking.service_date,booking.start_minute,booking.duration_minutes,booking.customer_timezone);
  const ownerTime=S.localLabel(booking.service_date,booking.start_minute,booking.duration_minutes);
  const text=`Interview support booking ${kind}\nName: ${booking.name}\nRole: ${booking.interview_role}\nCompany: ${booking.company||'—'}\nRound: ${booking.interview_round||'—'}\nMember time (${booking.customer_timezone}): ${memberTime}\nIST: ${ownerTime}\nDuration: ${booking.duration_minutes} minutes\nBooking ID: ${booking.id}\nWhatsApp: ${booking.phone}\nEmail: ${booking.email}\nManage bookings: ${process.env.APP_URL?process.env.APP_URL.replace(/\/$/,'')+'/member':'Open the website member page.'}`;
  const owner=process.env.OWNER_EMAIL||process.env.GMAIL_USER;
  const result=await Promise.allSettled([sendEmail(booking.email,'Interview support booking '+kind,text),owner?sendEmail(owner,'Interview support booking '+kind+' — '+booking.name,text):Promise.resolve(false)]);
  result.forEach(item=>{if(item.status==='rejected')console.error('Booking notification failed.');});
  return {member:result[0].status==='fulfilled'&&result[0].value===true,owner:result[1].status==='fulfilled'&&result[1].value===true};
}
module.exports={S,HttpError,response,body,admin,member,db,rpc,wrap,signAdmin,bookingId,validateBooking,monthRange,rowFields,publicBooking,notify,sendEmail};
