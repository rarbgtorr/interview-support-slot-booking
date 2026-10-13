const {wrap,response,db,monthRange}=require('./_shared');
exports.handler=wrap('GET',async event=>{
 const {from,next}=monthRange(event.queryStringParameters?.month);
 async function read(table,extra={}){const rows=[];for(let offset=0;;offset+=1000){const page=await db(table,{query:{select:'*',service_date:'gte.'+from,and:'(service_date.lt.'+next+')',order:table==='support_appointments'?'service_date.asc,start_minute.asc,id.asc':'service_date.asc,start_minute.asc,seat.asc',limit:'1000',offset:String(offset),...extra}});rows.push(...page);if(page.length<1000)return rows;}}
 const [appointments,reservations]=await Promise.all([read('support_appointments',{status:'neq.cancelled'}),read('support_slot_reservations')]);return response(200,{appointments,reservations});
},true);
