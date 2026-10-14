const {wrap,response,sameOrigin}=require('./_shared');const M=require('./_member');
exports.handler=wrap('POST',async event=>{sameOrigin(event);try{await M.auth('logout?scope=local',{token:M.accessToken(event)});}catch{}const r=response(200,{ok:true});r.headers['Set-Cookie']=M.cookie();return r;});
