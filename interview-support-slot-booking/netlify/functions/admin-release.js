const {wrap,response,body,rpc,bookingId,notify}=require('./_shared');
exports.handler=wrap('POST',async event=>{
  const row=await rpc('interview_cancel',{p_id:bookingId(body(event).id),p_email:null});
  await notify(row,'cancelled by administrator');
  return response(200,{id:row.id,status:'cancelled'});
},true);
