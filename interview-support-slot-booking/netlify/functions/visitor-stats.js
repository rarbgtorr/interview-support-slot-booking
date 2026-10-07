const {wrap,response,db,S}=require('./_shared');
exports.handler=wrap('GET',async()=>{
  const today=S.dateKey(new Date());
  const rows=await db('interview_visitor_stats',{query:{select:'visit_date,visit_count',order:'visit_date.desc'}});
  const lookup=new Map(rows.map(r=>[r.visit_date,Number(r.visit_count)]));
  return response(200,{todayVisitors:lookup.get(today)||0,totalVisitors:rows.reduce((sum,r)=>sum+Number(r.visit_count),0),daily:Array.from({length:7},(_,i)=>{const date=S.addDays(today,i-6);return {date,count:lookup.get(date)||0};})});
},true);
