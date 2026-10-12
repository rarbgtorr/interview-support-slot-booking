const {wrap,response,allRows}=require('./_shared');
exports.handler=wrap('GET',async()=>{const [customers,appointments]=await Promise.all([allRows('support_customers'),allRows('support_appointments')]);return response(200,{customers,appointments});},true);
