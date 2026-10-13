const {wrap,response,db,monthRange,S}=require('./_shared');
exports.handler=wrap('GET',async event=>{
 const {from,next}=monthRange(event.queryStringParameters?.month);const grouped=new Map(),now=Date.now();
 for(let offset=0;;offset+=1000){const page=await db('support_slot_reservations',{query:{select:'service_date,start_minute,kind',service_date:'gte.'+from,and:'(service_date.lt.'+next+')',order:'service_date.asc,start_minute.asc,seat.asc',limit:'1000',offset:String(offset)}});
  for(const r of page){if(S.instant(r.service_date,r.start_minute).getTime()<=now)continue;const key=r.service_date+':'+r.start_minute,slot=grouped.get(key)||{date:r.service_date,startMinute:r.start_minute,booked:0,blocked:false};if(r.kind==='blocked')slot.blocked=true;else if(r.kind==='booked')slot.booked++;grouped.set(key,slot);}if(page.length<1000)break;
 }
 return response(200,{slots:[...grouped.values()].map(s=>({date:s.date,startMinute:s.startMinute,remaining:s.blocked?0:Math.max(0,2-s.booked)}))});
});
