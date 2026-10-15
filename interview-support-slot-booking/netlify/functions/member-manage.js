const {response,body,rpc,bookingId,revision,HttpError,S,textField}=require('./_shared');const {memberWrap}=require('./_member');
exports.handler=memberWrap('POST',async(event,user)=>{
 const input=body(event);if(!['cancel','reschedule','edit'].includes(input.action))throw new HttpError(400,'Choose edit, cancel or reschedule.');
 let row;
 if(input.action==='edit'){
  const phone=textField(input,'phone',30,true),notes=textField(input,'notes',2000);
  if(!/^[+()\d\s-]{7,30}$/.test(phone)||!/^\d{7,15}$/.test(phone.replace(/\D/g,'')))throw new HttpError(400,'Enter a valid WhatsApp number with country code.');
  row=await rpc('support_member_edit',{p_email:user.email,p_id:bookingId(input.id),p_revision:revision(input.revision),p_phone:phone,p_notes:notes});
 }else{
  if(input.action==='reschedule'&&!S.validSelection(input.date,input.startMinute,30))throw new HttpError(400,'Choose a future 30-minute slot.');
  row=await rpc('support_member_manage',{p_email:user.email,p_id:bookingId(input.id),p_revision:revision(input.revision),p_action:input.action,p_date:input.action==='reschedule'?input.date:null,p_minute:input.action==='reschedule'?input.startMinute:null,p_request_id:input.action==='reschedule'?bookingId(input.requestId):null});
 }
 return response(200,{ok:true,booking:{id:row.id,date:row.service_date,startMinute:row.start_minute,status:row.status,revision:row.revision}});
});
