const crypto=require('node:crypto');
const {wrap,response,body,signAdmin,sessionCookie,sameOrigin,HttpError}=require('./_shared');
exports.handler=wrap('POST',async event=>{
 sameOrigin(event);const password=body(event).password,expected=process.env.ADMIN_PASSWORD;
 if(!expected||expected.length<12)throw new HttpError(503,'Administrator login is not configured.');
 if(typeof password!=='string'||password.length>200)throw new HttpError(401,'Incorrect administrator password.');
 const hash=value=>crypto.createHash('sha256').update(value).digest();
 if(!crypto.timingSafeEqual(hash(password),hash(expected)))throw new HttpError(401,'Incorrect administrator password.');
 const result=response(200,{ok:true});result.headers['Set-Cookie']=sessionCookie(signAdmin());return result;
});
exports.config={rateLimit:{windowLimit:10,windowSize:60,aggregateBy:['ip','domain']}};
