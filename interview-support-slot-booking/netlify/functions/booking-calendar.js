const {wrap,response,db,monthRange}=require('./_shared');
// Public read-only calendar, including customer details explicitly requested by the owner.
exports.handler=wrap('GET',async event=>{
 const {from,next}=monthRange(event.queryStringParameters?.month);const appointments=[];
 for(let offset=0;;offset+=1000){const page=await db('support_appointments',{query:{select:'id,booking_type,service_date,start_minute,duration_minutes,timezone,company,role,round,notes,status,customer:support_customers(name,phone,service_interest,timezone,stage,notes,follow_up_date)',service_date:'gte.'+from,and:'(service_date.lt.'+next+')',status:'neq.cancelled',order:'service_date.asc,start_minute.asc,id.asc',limit:'1000',offset:String(offset)}});appointments.push(...page);if(page.length<1000)break;}
 return response(200,{appointments});
});
