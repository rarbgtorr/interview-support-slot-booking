const {wrap,response,db,monthRange}=require('./_shared');
exports.handler=wrap('GET',async event=>{
  const {from,next}=monthRange(event.queryStringParameters?.month);
  const rows=await db('interview_slot_reservations',{query:{select:'service_date,start_minute,kind',service_date:'gte.'+from,and:'(service_date.lt.'+next+')'}});
  const days={};for(const row of rows){days[row.service_date]??={};days[row.service_date][row.start_minute]=row.kind;}
  return response(200,days);
});
