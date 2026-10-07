const {wrap,response,member,body,rpc,bookingId,notify}=require('./_shared');
exports.handler=wrap('POST',async event=>{
  const user=await member(event);
  const row=await rpc('interview_cancel',{p_id:bookingId(body(event).id),p_email:user.email});
  await notify(row,'cancelled');
  return response(200,{id:row.id,status:'cancelled'});
});
