const {wrap,response,body,validateAppointment}=require('./_shared');
const {bookWithDocuments}=require('./_documents');
exports.handler=wrap('POST',async event=>{const input=body(event),data=validateAppointment(input);const result=await bookWithDocuments(input,data,null,{admin:true,id:input.id||null});return response(200,{appointment:input.id?result:result[0]});},true);
