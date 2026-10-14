import {cleanupDocuments} from '../_shared/document-cleanup.mjs';
// A private token from Supabase Vault authenticates cron; never trust public callers.
Deno.serve(async(req: Request)=>{
 if(req.method!=='POST')return new Response('Method not allowed',{status:405});
 const token=req.headers.get('x-cleanup-token')||'';
 if(!/^[a-f0-9]{64}$/.test(token))return new Response('Unauthorized',{status:401});
 const base=Deno.env.get('SUPABASE_URL')!,key=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
 const headers={apikey:key,Authorization:'Bearer '+key,'Content-Type':'application/json'};
 async function call(path:string,method='GET',payload?:unknown){const r=await fetch(base+path,{method,headers,body:payload===undefined?undefined:JSON.stringify(payload)});if(!r.ok)throw Error('Cleanup service failed');return r.status===204?null:r.json();}
 try{
  const config=await call('/rest/v1/testing_support_cleanup_config?select=token_hash&id=eq.1');
  const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(token)))).map(x=>x.toString(16).padStart(2,'0')).join('');
  if(config[0]?.token_hash!==digest)return new Response('Unauthorized',{status:401});
  const result=await cleanupDocuments({
   claim:()=>call('/rest/v1/rpc/testing_support_claim_expired_documents','POST',{p_limit:50}),
   remove:(prefixes:string[])=>call('/storage/v1/object/testing-booking-documents','DELETE',{prefixes}),
   finish:(id:string)=>call('/rest/v1/testing_support_document_sets?id=eq.'+id+'&status=eq.deleting','PATCH',{status:'deleted',deleted_at:new Date().toISOString()})
  });
  return Response.json(result,{status:result.failed?500:200});
 }catch{return Response.json({error:'Cleanup failed; eligible files will be retried.'},{status:500});}
});
