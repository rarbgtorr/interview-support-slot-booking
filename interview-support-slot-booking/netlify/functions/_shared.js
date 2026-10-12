'use strict';
const S=require('../../public/schedule');
class HttpError extends Error { constructor(status,message){super(message);this.status=status;} }
class DatabaseError extends Error { constructor(code,message){super(message);this.code=code;} }
function response(status,body){return {statusCode:status,headers:{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'},body:JSON.stringify(body)};}
function body(event){try{if((event.body||'').length>12000)throw new Error();const parsed=JSON.parse(event.body||'{}');if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))throw new Error();return parsed;}catch{throw new HttpError(400,'Invalid request body.');}}
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
function wrap(method,handler){return async event=>{
  try{if(event.httpMethod!==method)return response(405,{error:'Method not allowed.'});return await handler(event);}
  catch(error){if(error instanceof HttpError)return response(error.status,{error:error.message});
    const code=error.code;
    if(code==='23505')return response(409,{error:'This slot is full or blocked. Choose another slot.'});
    if(code==='40001')return response(409,{error:'This record changed. Refresh it before saving again.'});
    if(code==='22023')return response(400,{error:error.message});
    if(code==='22007'||code==='22P02'||code==='23514'||code==='23502')return response(400,{error:'Check the details and select a valid time.'});
    if(code==='P0002')return response(404,{error:'Booking not found or no longer available to manage.'});
    if(code==='42501')return response(403,{error:'You do not have access to this booking, or the database permissions need configuration.'});
    console.error('Booking request failed:',code||error.name);return response(500,{error:'Unable to complete this request. Please try again.'});}
};}
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function bookingId(value){if(typeof value!=='string'||!UUID.test(value))throw new HttpError(400,'A valid booking ID is required.');return value;}
function textField(input,key,max,required=false){const value=input[key]??'';if(typeof value!=='string'||value.length>max|| (required&&!value.trim()))throw new HttpError(400,'Please check the '+key+' field.');return value.trim();}
function revision(value){if(!Number.isInteger(value)||value<0)throw new HttpError(400,'Refresh before saving changes.');return value;}
function validateAppointment(input){
 if(!S.validSelection(input.date,input.startMinute,30)||input.duration!==30)throw new HttpError(400,'Choose a future 30-minute slot.');
 if(!['demo','interview'].includes(input.type)||!S.validZone(input.timezone))throw new HttpError(400,'Choose a booking type and valid member timezone.');
 const memberName=textField(input,'memberName',100,true),phone=textField(input,'phone',30,true);
 if(!/^[+()\d\s-]{7,30}$/.test(phone)||!/^\d{7,15}$/.test(phone.replace(/\D/g,'')))throw new HttpError(400,'Enter a valid WhatsApp number with country code.');
 const data={date:input.date,startMinute:input.startMinute,duration:30,type:input.type,requestId:bookingId(input.requestId),timezone:input.timezone,memberName,phone,company:textField(input,'company',150,true),experience:textField(input,'experience',100,true),round:textField(input,'round',100,true)};
 if(input.id){bookingId(input.id);data.revision=revision(input.revision);}
 return data;
}
function monthRange(month){if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month||''))throw new HttpError(400,'Select a valid month.');const from=month+'-01';if(!S.validDate(from))throw new HttpError(400,'Invalid month.');const [year,m]=month.split('-').map(Number);const next=new Date(Date.UTC(year,m,1)).toISOString().slice(0,10);return {from,next};}
async function allRows(table,select='*'){
  const rows=[];const limit=1000;
  for(let offset=0;;offset+=limit){const page=await db(table,{query:{select,order:'created_at.asc,id.asc',limit:String(limit),offset:String(offset)}});if(!Array.isArray(page))throw new HttpError(502,'Invalid database response.');rows.push(...page);if(page.length<limit)return rows;}
}
module.exports={S,HttpError,response,body,db,rpc,wrap,bookingId,validateAppointment,revision,monthRange,allRows};
