const {wrap,response,member,db,rowFields}=require('./_shared');
exports.handler=wrap('GET',async event=>{
  const user=await member(event);
  const bookings=await db('interview_bookings',{query:{select:rowFields,email:'eq.'+user.email,order:'starts_at.desc',limit:'1000'}});
  return response(200,{email:user.email,bookings});
});
