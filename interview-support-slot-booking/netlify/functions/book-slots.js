const {wrap,response,body,validateSlotBooking,HttpError}=require('./_shared');
const {bookWithDocuments}=require('./_documents');
exports.handler=wrap('POST',async event=>{const input=body(event),{data,slots}=validateSlotBooking(input);let appointments;try{appointments=await bookWithDocuments(input,data,slots);}catch(error){if(error.code==='23505')throw new HttpError(409,'A selected slot is already booked or blocked. Choose a free slot.');throw error;}return response(200,{bookings:appointments.map(a=>({date:a.service_date,startMinute:a.start_minute,duration:30,type:a.booking_type,timezone:a.timezone}))});});
exports.config={rateLimit:{windowLimit:30,windowSize:60,aggregateBy:['ip','domain']}};
