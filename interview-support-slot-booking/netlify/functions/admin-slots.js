const {wrap,response,db,monthRange,rowFields}=require('./_shared');
exports.handler=wrap('GET',async event=>{
  const {from,next}=monthRange(event.queryStringParameters?.month);
  const rows=await db('interview_slot_reservations',{query:{select:'service_date,start_minute,kind,booking:interview_bookings('+rowFields+')',service_date:'gte.'+from,and:'(service_date.lt.'+next+')'}});
  const days={};for(const row of rows){days[row.service_date]??={};days[row.service_date][row.start_minute]={status:row.kind,booking:row.booking};}
  return response(200,{days});
},true);
