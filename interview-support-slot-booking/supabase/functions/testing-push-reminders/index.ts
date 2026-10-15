import webpush from 'npm:web-push@3.6.7';
import {deliverPush,processReminders} from '../_shared/push-reminders.mjs';
Deno.serve(async(req: Request)=>{
 if(req.method!=='POST')return new Response('Method not allowed',{status:405});
 const token=req.headers.get('x-reminder-token')||'';
 if(!/^[a-f0-9]{64}$/.test(token))return new Response('Unauthorized',{status:401});
 const base=Deno.env.get('SUPABASE_URL')!,key=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
 const headers={apikey:key,Authorization:'Bearer '+key,'Content-Type':'application/json'};
 async function call(path:string,method='GET',payload?:unknown){const r=await fetch(base+path,{method,headers,body:payload===undefined?undefined:JSON.stringify(payload),signal:AbortSignal.timeout(15000)});if(!r.ok)throw Error('private_service_error');return r.status===204?null:r.json();}
 const rpc=(name:string,payload:unknown={})=>call('/rest/v1/rpc/'+name,'POST',payload);
 try{
  const config=await call('/rest/v1/testing_support_push_config?select=token_hash&id=eq.1');
  const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(token)))).map(x=>x.toString(16).padStart(2,'0')).join('');
  if(config[0]?.token_hash!==hash)return new Response('Unauthorized',{status:401});
  const input=await req.json();if(!['init','run','test'].includes(input.action))return new Response('Invalid action',{status:400});
  let vapid=await rpc('testing_support_push_runtime');
  if(!vapid?.publicKey){const keys=webpush.generateVAPIDKeys();vapid=await rpc('testing_support_push_install',{p_public:keys.publicKey,p_private:keys.privateKey});}
  if(!vapid?.privateKey)throw Error('private_key_unavailable');
  if(input.action==='init')return Response.json({configured:true});
  await call('/rest/v1/testing_support_push_config?id=eq.1','PATCH',{last_worker_at:new Date().toISOString()});
  if(input.action==='test'){
   if(typeof input.deviceId!=='string'||!/^[0-9a-f-]{36}$/i.test(input.deviceId))return new Response('Invalid device',{status:400});
   const device=await rpc('testing_support_push_test_claim',{p_id:input.deviceId});
   const outcome=await deliverPush({item:{...device,keys:{p256dh:device.p256dh,auth:device.auth}},vapid,encode:webpush.generateRequestDetails,payload:{title:'Reminders are working',body:'This Android phone is ready for demo and interview reminders, 45 minutes before the start.',tag:'admin-reminder-test-'+Date.now(),url:'/admin'}});
   if(outcome.result==='gone')await rpc('testing_support_push_disable',{p_id:device.id});
   if(outcome.result==='sent')await call('/rest/v1/testing_support_push_devices?id=eq.'+device.id,'PATCH',{last_test_at:new Date().toISOString(),error_code:null});
   return Response.json({ok:outcome.result==='sent'},{status:outcome.result==='sent'?200:502});
  }
  const result=await processReminders({rpc,vapid,encode:webpush.generateRequestDetails});return Response.json(result,{status:result.failed?503:200});
 }catch{console.error('Testing push operation failed');return Response.json({error:'Reminder operation failed. Please retry.'},{status:503});}
});
