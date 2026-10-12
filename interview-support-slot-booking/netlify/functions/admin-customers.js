const {wrap,response,body,rpc,validateCustomer}=require('./_shared');
exports.handler=wrap('POST',async event=>{const input=body(event);const data=validateCustomer(input);return response(200,{customer:await rpc('support_save_customer',{p_data:data,p_id:input.id||null})});},true);
