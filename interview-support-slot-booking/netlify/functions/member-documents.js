'use strict';
const crypto=require('node:crypto');
const {response,body,rpc,db,bookingId,revision,textField,HttpError}=require('./_shared');
const {memberWrap}=require('./_member');
const D=require('./_documents');
const read=memberWrap('GET',async(event,user)=>{
 const input=event.queryStringParameters||{},id=bookingId(input.appointmentId),info=await rpc('support_member_document_info',{p_email:user.email,p_id:id});
 if(!input.kind)return response(200,info);
 if(!info.available)throw new HttpError(410,'Documents have expired and are no longer available.');
 const rows=await db('support_appointments',{query:{select:'document_set_id',id:'eq.'+id,email:'eq.'+user.email}}),a=rows?.[0];if(!a?.document_set_id)throw new HttpError(404,'Document not found.');
 const sets=await db('support_document_sets',{query:{select:'resume,invite_file,jd_file,additional_files,status',id:'eq.'+a.document_set_id}}),docs=sets?.[0];if(docs?.status!=='attached')throw new HttpError(410,'Documents are no longer available.');
 const expires=await rpc('support_document_expiry',{p_document_id:a.document_set_id});return response(200,{url:await D.signedDownload(D.documentFile(docs,input.kind),expires)});
});
const write=memberWrap('POST',async(event,user)=>{
 const input=body(event),id=bookingId(input.appointmentId);
 if(input.action==='saveNotes'){
  const rows=await db('support_appointments',{query:{select:'whatsapp',id:'eq.'+id,email:'eq.'+user.email}});if(!rows?.[0])throw new HttpError(404,'Booking not found.');
  return response(200,await rpc('support_member_edit',{p_email:user.email,p_id:id,p_revision:revision(input.revision),p_phone:rows[0].whatsapp,p_notes:textField(input,'notes',2000)}));
 }
 if(input.action==='prepare'){
  if(input.inviteFile!=null||(Array.isArray(input.removeKinds)&&input.removeKinds.includes('invite')))throw new HttpError(400,'Interview invite screenshots cannot be changed.');
  const uploadId=crypto.randomUUID(),resume=input.resume?D.metadata(input.resume,'resume',uploadId):null,jdFile=input.jdFile?D.metadata(input.jdFile,'jd',uploadId):null,jdText=textField(input,'jdText',10000),extras=input.additionalFiles??[];
  if(!Array.isArray(extras)||extras.length>6)throw new HttpError(400,'Choose up to six additional documents.');
  const additionalFiles=extras.map((f,i)=>D.metadata(f,'additional-'+(i+1),uploadId));
  await rpc('support_prepare_member_document_update',{p_email:user.email,p_id:id,p_revision:revision(input.revision),p_document_revision:revision(input.documentRevision),p_upload_id:uploadId,p_token_hash:D.hash(crypto.randomBytes(32).toString('hex')),p_resume:resume,p_notes:input.notes===undefined?null:textField(input,'notes',2000),p_remove_kinds:input.removeKinds??[],p_jd_mode:input.jdMode,p_jd_file:jdFile,p_jd_text:jdText,p_additional_files:additionalFiles});
  const uploads=await Promise.all([resume,jdFile,...additionalFiles].filter(Boolean).map(D.signedUpload));
  return response(200,{updateId:uploadId,uploads});
 }
 if(input.action==='save'){
  const uploadId=bookingId(input.updateId),sets=await db('support_document_sets',{query:{select:'purpose,status,resume,invite_file,jd_file,additional_files,created_at',id:'eq.'+uploadId,owner_email:'eq.'+user.email,target_appointment_id:'eq.'+id}}),draft=sets?.[0];
  if(!draft||draft.purpose!=='member_edit')throw new HttpError(404,'Document update not found.');
  if(draft.status!=='transferred'){
   if(draft.status!=='pending'||Date.parse(draft.created_at)+86400000<=Date.now())throw new HttpError(410,'This document update expired. Reopen Documents and try again.');
   await D.verifyStoredFiles([draft.resume,draft.invite_file,draft.jd_file,...(draft.additional_files||[])].filter(Boolean));
  }
  return response(200,await rpc('support_commit_member_documents',{p_email:user.email,p_id:id,p_upload_id:uploadId}));
 }
 throw new HttpError(400,'Choose a valid document action.');
});
exports.handler=event=>event.httpMethod==='GET'?read(event):write(event);
exports.config={rateLimit:{windowLimit:30,windowSize:60,aggregateBy:['ip','domain']}};
