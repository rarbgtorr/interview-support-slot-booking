'use strict';
window.MemberAuth = (function () {
  let pending;
  async function client() {
    if (!pending) pending = (async()=>{
      if (!window.supabase) throw new Error('Member login could not load. Please refresh and try again.');
      const response=await fetch('/.netlify/functions/member-config',{cache:'no-store'});
      const config=await response.json();
      if(!response.ok)throw new Error(config.error||'Member login is not configured yet.');
      return window.supabase.createClient(config.url,config.anonKey,{auth:{storageKey:'interview-support-member',persistSession:true,autoRefreshToken:true,detectSessionInUrl:false}});
    })().catch(error=>{pending=null;throw error;});
    return pending;
  }
  async function session() {
    const auth=await client();
    const {data,error}=await auth.auth.getSession();
    if(error)throw error;
    return data.session;
  }
  async function request(path,options={}) {
    const current=await session();
    if(!current)throw new Error('Please log in to manage your bookings.');
    const response=await fetch('/.netlify/functions/'+path,{...options,cache:'no-store',headers:{'Content-Type':'application/json',...(options.headers||{}),Authorization:'Bearer '+current.access_token}});
    const body=await response.json();
    if(!response.ok)throw new Error(body.error||'Unable to complete this request.');
    return body;
  }
  return {client,session,request};
})();
