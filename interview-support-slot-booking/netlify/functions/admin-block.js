const {wrap,response,body,rpc,S,HttpError}=require('./_shared');
exports.handler=wrap('POST',async event=>{
  const input=body(event);
  if(Array.isArray(input.slots)){
    if(!['available','blocked'].includes(input.status)||input.slots.length<1||input.slots.length>200)throw new HttpError(400,'Select one to 200 future slots.');
    const slots=input.slots.map(x=>{if(!x||!S.validSelection(x.date,x.startMinute,30))throw new HttpError(400,'Choose future 30-minute slots.');return {date:x.date,startMinute:x.startMinute};});
    if(new Set(slots.map(x=>x.date+':'+x.startMinute)).size!==slots.length)throw new HttpError(400,'Select different slots.');
    return response(200,{changed:await rpc('support_block_slots',{p_slots:slots,p_status:input.status})});
  }
  if(!S.validDate(input.date)||!['available','blocked'].includes(input.status))throw new HttpError(400,'Invalid slot selection.');
  if(input.wholeDay!==true&&!S.STARTS.includes(input.startMinute))throw new HttpError(400,'Invalid slot.');
  const changed=await rpc('support_block',{p_date:input.date,p_minute:input.wholeDay===true?null:input.startMinute,p_status:input.status});
  return response(200,{changed});
},true);
