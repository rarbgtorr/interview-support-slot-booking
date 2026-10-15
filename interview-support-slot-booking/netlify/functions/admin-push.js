'use strict';
const {wrap,response,body,rpc,db,dataset,bookingId,S,HttpError}=require('./_shared');
async function invoke(action,deviceId){
 const gateway=await rpc('support_push_gateway_config',{});
 if(gateway?.url!=='https://nmgjkexfgytjivxudsmo.supabase.co/functions/v1/testing-push-reminders'||!/^[a-f0-9]{64}$/.test(gateway.token||''))throw new HttpError(503,'Reminders are being configured. Please try again shortly.');
 const r=await fetch(gateway.url,{method:'POST',headers:{'Content-Type':'application/json','x-reminder-token':gateway.token},body:JSON.stringify({action,...(deviceId?{deviceId}:{})}),redirect:'error',signal:AbortSignal.timeout(25000)});
 if(!r.ok)throw new HttpError(503,'The notification could not be sent. Check this phone’s permissions, or disable and enable reminders again.');
}
exports.handler=wrap('POST',async event=>{
 if(dataset()!=='testing')throw new HttpError(503,'Reminders are currently configured for Testing only.');
 const input=body(event),action=input.action;
 const {pushEndpoint,subscriptionKeys,siteOrigin}=await import('../../supabase/functions/_shared/push-reminders.mjs');
 let endpoint=null;if(input.endpoint!==undefined&&input.endpoint!==null){try{endpoint=pushEndpoint(input.endpoint);}catch{throw new HttpError(400,'Use Chrome on Android to enable reminders.');}}
 if(action==='status'){
  let status=await rpc('support_push_status',{p_endpoint:endpoint});
  if(!status?.configured){await invoke('init');status=await rpc('support_push_status',{p_endpoint:endpoint});}
  return response(200,status);
 }
 if(action==='subscribe'){
  let keys,origin;try{endpoint=pushEndpoint(input.subscription?.endpoint);keys=subscriptionKeys(input.subscription?.keys);origin=siteOrigin(input.origin,!process.env.NETLIFY);}catch{throw new HttpError(400,'Use the administrator page in Chrome on Android to enable reminders.');}
  const requestOrigin=event.headers?.origin||event.headers?.Origin;
  if(requestOrigin&&requestOrigin!==origin)throw new HttpError(403,'Enable reminders from this website.');
  if(!S.validZone(input.timezone))throw new HttpError(400,'Select a valid notification timezone.');
  const status=await rpc('support_push_subscribe',{p_data:{endpoint,...keys,origin,timezone:input.timezone}});return response(200,status);
 }
 if(action==='disable'){await rpc('support_push_disable',{p_id:bookingId(input.deviceId)});return response(200,{ok:true});}
 if(action==='test'){const id=bookingId(input.deviceId);const rows=await db('support_push_devices',{query:{select:'id,endpoint,last_test_requested_at',id:'eq.'+id,enabled:'eq.true'}});
  if(!rows.length||rows[0].endpoint!==endpoint)throw new HttpError(400,'Enable reminders on this phone first.');
  if(rows[0].last_test_requested_at&&Date.parse(rows[0].last_test_requested_at)>Date.now()-60000)throw new HttpError(429,'Wait one minute before sending another test notification.');
  await invoke('test',id);return response(200,{ok:true});}
 throw new HttpError(400,'Invalid reminder action.');
},true);
exports.config={rateLimit:{windowLimit:30,windowSize:60,aggregateBy:['ip','domain']}};
