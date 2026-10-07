const {wrap,response,body,rpc,validateBooking,publicBooking,notify}=require('./_shared');
exports.handler=wrap('POST',async event=>{
  const input=validateBooking(body(event));
  const result=await rpc('interview_reserve',{p_data:input,p_email:null,p_booking_id:null});
  const notifications=result.replayed?{member:false,owner:false}:await notify(result);
  return response(200,{booking:publicBooking(result),notifications,replayed:result.replayed});
});

exports.config={rateLimit:{windowLimit:20,windowSize:60,aggregateBy:["ip","domain"]}};
