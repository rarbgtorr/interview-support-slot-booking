const {wrap,response,member,body,rpc,bookingId,validateBooking,publicBooking,notify,HttpError}=require('./_shared');
exports.handler=wrap('POST',async event=>{
  const user=await member(event),raw=body(event);
  const input=validateBooking(raw);
  if(input.email!==user.email)throw new HttpError(403,'Use the verified email for your booking.');
  const result=await rpc('interview_reserve',{p_data:input,p_email:user.email,p_booking_id:bookingId(raw.id)});
  const notifications=result.replayed?{member:false,owner:false}:await notify(result,'rescheduled');
  return response(200,{booking:publicBooking(result),notifications,replayed:result.replayed});
});
