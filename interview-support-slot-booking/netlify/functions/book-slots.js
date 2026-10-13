const {wrap,response,body,rpc,validateSlotBooking}=require('./_shared');
exports.handler=wrap('POST',async event=>{const {data,slots}=validateSlotBooking(body(event));const appointments=await rpc('support_book_slots',{p_data:data,p_slots:slots});return response(200,{bookings:appointments.map(a=>({date:a.service_date,startMinute:a.start_minute,duration:30,type:a.booking_type,timezone:a.timezone}))});});
exports.config={rateLimit:{windowLimit:30,windowSize:60,aggregateBy:['ip','domain']}};
