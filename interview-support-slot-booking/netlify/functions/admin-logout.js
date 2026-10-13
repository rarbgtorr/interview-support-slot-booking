const {wrap,response,sessionCookie,sameOrigin}=require('./_shared');
exports.handler=wrap('POST',async event=>{sameOrigin(event);const r=response(200,{ok:true});r.headers['Set-Cookie']=sessionCookie('',0);return r;});
