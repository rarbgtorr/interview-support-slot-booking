const {wrap,response,db,monthRange}=require('./_shared');
exports.handler=wrap('GET',async event=>{
  const {from,next}=monthRange(event.queryStringParameters?.month);
  const rows=[];for(let offset=0;;offset+=1000){const page=await db('support_slot_reservations',{query:{select:'service_date,start_minute,kind,appointment_id',service_date:'gte.'+from,and:'(service_date.lt.'+next+')',order:'service_date.asc,start_minute.asc',limit:'1000',offset:String(offset)}});rows.push(...page);if(page.length<1000)break;}
  const days={};for(const row of rows){days[row.service_date]??={};days[row.service_date][row.start_minute]={status:row.kind,appointmentId:row.appointment_id};}
  return response(200,{days});
},true);
