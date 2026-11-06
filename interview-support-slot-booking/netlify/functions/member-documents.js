'use strict';
const crypto=require('node:crypto');
const {response,body,rpc,db,bookingId,revision,textField,HttpError}=require('./_shared');
const {memberWrap}=require('./_member');
const D=require('./_documents');
const read=memberWrap('GET',async(event,user)=>response(200,await rpc('support_member_document_info',{p_email:user.email,p_id:bookingId(event.queryStringParameters?.appointmentId)})));
const write=memberWrap('POST',async(event,user)=>{
 const input=body(event),id=bookingId(input.appointmentId);
 if(input.action==='prepare'){
  const uploadId=crypto.randomUUID(),resume=input.resume?D.metadata(input.resume,'resume',uploadId):null,jdFile=input.jdFile?D.metadata(input.jdFile,'jd',uploadId):null,jdText=textField(input,'jdText',10000),extras=input.additionalFiles??[];
  if(!Array.isArray(extras)||extras.length>6)throw new HttpError(400,'Choose up to six additional documents.');
  const additionalFiles=extras.map((f,i)=>D.metadata(f,'additional-'+(i+1),uploadId));
  await rpc('support_prepare_member_documents',{p_email:user.email,p_id:id,p_revision:revision(input.revision),p_document_revision:revision(input.documentRevision),p_upload_id:uploadId,p_token_hash:D.hash(crypto.randomBytes(32).toString('hex')),p_resume:resume,p_jd_mode:input.jdMode,p_jd_file:jdFile,p_jd_text:jdText,p_additional_files:additionalFiles});
  const uploads=await Promise.all([resume,jdFile,...additionalFiles].filter(Boolean).map(D.signedUpload));
  return response(200,{updateId:uploadId,uploads});
 }
 if(input.action==='save'){
  const uploadId=bookingId(input.updateId),sets=await db('support_document_sets',{query:{select:'purpose,status,resume,jd_file,additional_files,created_at',id:'eq.'+uploadId,owner_email:'eq.'+user.email,target_appointment_id:'eq.'+id}}),draft=sets?.[0];
  if(!draft||draft.purpose!=='member_edit')throw new HttpError(404,'Document update not found.');
  if(draft.status!=='transferred'){
   if(draft.status!=='pending'||Date.parse(draft.created_at)+86400000<=Date.now())throw new HttpError(410,'This document update expired. Reopen Documents and try again.');
   await D.verifyStoredFiles([draft.resume,draft.jd_file,...(draft.additional_files||[])].filter(Boolean));
  }
  return response(200,await rpc('support_commit_member_documents',{p_email:user.email,p_id:id,p_upload_id:uploadId}));
 }
 throw new HttpError(400,'Choose a valid document action.');
});
exports.handler=event=>event.httpMethod==='GET'?read(event):write(event);
exports.config={rateLimit:{windowLimit:30,windowSize:60,aggregateBy:['ip','domain']}};
