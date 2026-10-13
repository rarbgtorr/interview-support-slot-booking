const {wrap,response,body,rpc,validateAppointment}=require('./_shared');
exports.handler=wrap('POST',async event=>{const input=body(event);const data=validateAppointment(input);return response(200,{appointment:await rpc('support_book_direct',{p_data:data,p_id:input.id||null})});},true);
