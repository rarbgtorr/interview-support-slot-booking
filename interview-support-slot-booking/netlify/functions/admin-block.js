const {wrap,response,body,rpc,S,HttpError}=require('./_shared');
exports.handler=wrap('POST',async event=>{
  const input=body(event);
  if(!S.validDate(input.date)||!['available','blocked'].includes(input.status))throw new HttpError(400,'Invalid slot selection.');
  if(input.wholeDay!==true&&!S.STARTS.includes(input.startMinute))throw new HttpError(400,'Invalid slot.');
  const changed=await rpc('support_block',{p_date:input.date,p_minute:input.wholeDay===true?null:input.startMinute,p_status:input.status});
  return response(200,{changed});
},true);
