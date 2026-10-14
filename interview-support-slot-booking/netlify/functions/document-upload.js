const crypto=require('node:crypto');
const {wrap,response,body,rpc,textField,sameOrigin,HttpError}=require('./_shared');
const D=require('./_documents');
exports.handler=wrap('POST',async event=>{sameOrigin(event);const input=body(event),id=crypto.randomUUID(),token=crypto.randomBytes(32).toString('hex');const resume=D.metadata(input.resume,'resume',id),jdFile=input.jdFile?D.metadata(input.jdFile,'jd',id):null,jdText=textField(input,'jdText',10000);if((!jdFile&&!jdText)||(jdFile&&jdText))throw new HttpError(400,'Upload a JD file or paste JD text.');await rpc('support_create_document_set',{p_id:id,p_token_hash:D.hash(token),p_resume:resume,p_jd_file:jdFile,p_jd_text:jdText});const uploads=await Promise.all([resume,jdFile].filter(Boolean).map(D.signedUpload));return response(200,{documentSetId:id,documentToken:token,uploads});});
exports.config={rateLimit:{windowLimit:10,windowSize:60,aggregateBy:['ip','domain']}};
