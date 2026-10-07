const {response,db,sendEmail,S}=require('./_shared');
exports.handler=async()=>{
  const now=Date.now(),from=new Date(now+50*60000).toISOString(),to=new Date(now+65*60000).toISOString();
  try{
    const rows=await db('interview_bookings',{query:{select:'*',status:'eq.booked',starts_at:'gte.'+from,and:'(starts_at.lte.'+to+')'}});
    let sent=0;
    for(const row of rows){
      const patch={},base='Interview support starts in about one hour.\\nRole: '+row.interview_role+'\\nBooking ID: '+row.id;
      if(!row.reminder_member_at){try{if(await sendEmail(row.email,'Reminder: your interview support slot',base+'\\n'+S.localLabel(row.service_date,row.start_minute,row.duration_minutes,row.customer_timezone)+' · '+row.customer_timezone))patch.reminder_member_at=new Date().toISOString();}catch{console.error('Member reminder failed.');}}
      if(!row.reminder_owner_at){try{const owner=process.env.OWNER_EMAIL||process.env.GMAIL_USER;if(owner&&await sendEmail(owner,'Upcoming interview support — '+row.name,base+'\\n'+S.localLabel(row.service_date,row.start_minute,row.duration_minutes)+' · IST'))patch.reminder_owner_at=new Date().toISOString();}catch{console.error('Owner reminder failed.');}}
      if(Object.keys(patch).length){await db('interview_bookings',{method:'PATCH',query:{id:'eq.'+row.id,revision:'eq.'+row.revision,status:'eq.booked'},body:patch});sent++;}
    }
    return response(200,{sent});
  }catch(error){console.error('Reminders failed:',error.code||error.name);return response(500,{error:'Unable to send reminders.'});}
};
