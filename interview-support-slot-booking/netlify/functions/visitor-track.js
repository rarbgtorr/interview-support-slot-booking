const {wrap,response,rpc,S}=require('./_shared');
exports.handler=wrap('POST',async()=>{await rpc('interview_record_visit',{p_date:S.dateKey(new Date())});return response(200,{recorded:true});});
