const {wrap,response,HttpError}=require('./_shared');
exports.handler=wrap('GET',async()=>{
  const url=process.env.SUPABASE_URL,anonKey=process.env.SUPABASE_PUBLISHABLE_KEY||process.env.SUPABASE_ANON_KEY;
  if(!url||!anonKey)throw new HttpError(503,'Member login is not configured yet.');
  if(anonKey.startsWith('sb_secret_')||anonKey===process.env.SUPABASE_SERVICE_ROLE_KEY||anonKey===process.env.SUPABASE_SECRET_KEY)throw new HttpError(503,'Member login needs a public key, not a server secret.');
  if(anonKey.startsWith('eyJ')){try{const claims=JSON.parse(Buffer.from(anonKey.split('.')[1],'base64url'));if(claims.role!=='anon')throw new Error();}catch{throw new HttpError(503,'Member login requires a public authentication key.');}}
  return response(200,{url,anonKey});
});
