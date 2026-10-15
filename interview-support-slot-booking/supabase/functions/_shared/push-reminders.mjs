export function pushEndpoint(value){
 let u;try{u=new URL(value);}catch{throw Error('invalid_endpoint');}
 if(typeof value!=='string'||value.length>4096||u.protocol!=='https:'||u.hostname!=='fcm.googleapis.com'||u.port||u.username||u.password||u.search||u.hash||!/^\/(fcm\/send|wp)\/[A-Za-z0-9_:/=-]+$/.test(u.pathname))throw Error('invalid_endpoint');
 return u.href;
}
export function siteOrigin(value,local=false){
 let u;try{u=new URL(value);}catch{throw Error('invalid_origin');}
 const hosted=u.protocol==='https:'&&!u.port&&/^([a-z0-9-]+--)?interview-slot-booking\.netlify\.app$/.test(u.hostname);
 if((!hosted&&!(local&&u.protocol==='http:'&&u.hostname==='localhost'))||u.username||u.password||u.pathname!=='/'||u.search||u.hash)throw Error('invalid_origin');
 return u.origin;
}
export function subscriptionKeys(keys){
 const decode=value=>{if(typeof value!=='string'||!/^[A-Za-z0-9_-]+$/.test(value))throw Error('invalid_keys');return Uint8Array.from(atob(value.replaceAll('-','+').replaceAll('_','/')),c=>c.charCodeAt(0));};
 const p=decode(keys?.p256dh),a=decode(keys?.auth);
 if(p.length!==65||p[0]!==4||a.length!==16||keys.p256dh.length!==87||keys.auth.length!==22)throw Error('invalid_keys');
 return {p256dh:keys.p256dh,auth:keys.auth};
}
export function reminderPayload(item,now=Date.now()){
 const start=Date.parse(item.startsAt),minutes=Math.max(1,Math.ceil((start-now)/60000));
 const fmt=new Intl.DateTimeFormat('en-IN',{timeZone:item.timezone,dateStyle:'medium',timeStyle:'short'});
 return {title:(item.type==='demo'?'Demo':'Interview')+' in '+minutes+' '+(minutes===1?'minute':'minutes'),body:item.name+' · '+fmt.format(new Date(start))+' · '+item.timezone+(item.slotCount>1?' · '+item.slotCount+' consecutive slots':''),
  tag:'booking-'+item.appointmentId+'-'+start,startsAt:item.startsAt,url:'/admin?date='+encodeURIComponent(item.date)+'&appointment='+encodeURIComponent(item.appointmentId)};
}
export async function deliverPush({item,payload,vapid,encode,fetcher=fetch,now=Date.now()}){
 const endpoint=pushEndpoint(item.endpoint);siteOrigin(item.origin,true);subscriptionKeys(item.keys);
 const ttl=payload.startsAt?Math.max(1,Math.min(2700,Math.ceil((Date.parse(payload.startsAt)-now)/1000))):60;
 const details=encode({endpoint,keys:item.keys},JSON.stringify(payload),{vapidDetails:{subject:vapid.subject,publicKey:vapid.publicKey,privateKey:vapid.privateKey},TTL:ttl,urgency:'high'});
 const r=await fetcher(endpoint,{method:'POST',headers:details.headers,body:new Uint8Array(details.body),redirect:'error',signal:AbortSignal.timeout(10000)});
 return {result:r.ok?'sent':[404,410].includes(r.status)?'gone':'failed',status:r.status};
}
export async function processReminders({rpc,vapid,encode,fetcher=fetch,now=Date.now()}){
 const claims=await rpc('testing_support_claim_push_reminders',{p_limit:20});
 const result={sent:0,failed:0,skipped:0};
 async function next(){let claim;while((claim=claims.shift())){
  const params={p_id:claim.id,p_claim_token:claim.claimToken};
  const item=await rpc('testing_support_prepare_push_reminder',params);
  if(!item){result.skipped++;continue;}
  let outcome;try{outcome=await deliverPush({item,payload:reminderPayload(item,now),vapid,encode,fetcher,now});}catch{outcome={result:'failed',status:null};}
  await rpc('testing_support_finish_push_reminder',{...params,p_result:outcome.result,p_status:outcome.status});
  result[outcome.result==='sent'?'sent':outcome.result==='gone'?'skipped':'failed']++;
 }}
 await Promise.all(Array.from({length:Math.min(4,claims.length)},next));return result;
}
