const {wrap,response,body,emailAddress,sameOrigin}=require('./_shared');const {auth}=require('./_member');
exports.handler=wrap('POST',async event=>{sameOrigin(event);const email=emailAddress(body(event).email);await auth('otp',{data:{email,create_user:true}});return response(200,{ok:true});});
exports.config={rateLimit:{windowLimit:5,windowSize:60,aggregateBy:['ip','domain']}};
