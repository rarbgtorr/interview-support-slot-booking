'use strict';
const S=Schedule,$=id=>document.getElementById(id);
const initial=S.currentServiceDate();
let month=new Date(initial+'T12:00:00'),selected=initial,activeGroup='morning',days={},loading=false,sequence=0;
month.setDate(1);
const monthKey=()=>`${month.getFullYear()}-${String(month.getMonth()+1).padStart(2,'0')}`;
const escapeHtml=value=>String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const token=()=>sessionStorage.getItem('interviewAdminToken');
async function api(path,options={}) {
  if(!token())throw new Error('Please log in first.');
  const response=await fetch('/.netlify/functions/'+path,{...options,cache:'no-store',headers:{'Content-Type':'application/json',...(options.headers||{}),Authorization:'Bearer '+token()}});
  const body=await response.json();
  if(!response.ok){if(response.status===401){sessionStorage.removeItem('interviewAdminToken');showLogin('Session expired. Please log in again.');}throw new Error(body.error||'Request failed.');}
  return body;
}
function showLogin(message=''){$('loginCard').classList.remove('hidden');$('adminApp').classList.add('hidden');$('adminLogout').classList.add('hidden');$('loginError').textContent=message;}
async function load(){
  const current=++sequence;loading=true;$('adminMessage').textContent='Loading availability…';
  try{const result=await api('admin-slots?month='+monthKey());if(current!==sequence)return;days=result.days;loading=false;render();$('adminMessage').textContent='';}
  catch(error){if(current!==sequence)return;loading=false;$('adminMessage').textContent=error.message;return;}
  try{const stats=await api('visitor-stats');$('visitorTodayCount').textContent=stats.todayVisitors;$('visitorTotalCount').textContent=stats.totalVisitors;$('visitorBreakdown').replaceChildren(...stats.daily.map(day=>{const row=document.createElement('div');row.className='visitor-day';row.innerHTML=`<span>${escapeHtml(day.date)}</span><strong>${day.count}</strong>`;return row;}));}catch{$('visitorBreakdown').textContent='Visitor statistics unavailable.';}
}
function render(){
  $('loginCard').classList.add('hidden');$('adminApp').classList.remove('hidden');$('adminLogout').classList.remove('hidden');
  $('adminMonth').textContent=month.toLocaleDateString('en-IN',{month:'long',year:'numeric'});$('adminSelected').textContent=S.dateLabel(selected);
  const earliest=S.currentServiceDate();$('adminPrev').disabled=monthKey()<=earliest.slice(0,7);
  const grid=$('adminGrid');grid.replaceChildren();
  for(let i=0;i<month.getDay();i++){const blank=document.createElement('span');blank.className='day muted';grid.append(blank);}
  const last=new Date(month.getFullYear(),month.getMonth()+1,0).getDate();
  for(let n=1;n<=last;n++){
    const date=monthKey()+'-'+String(n).padStart(2,'0'),button=document.createElement('button');button.type='button';button.className='day';button.textContent=n;button.setAttribute('aria-label',S.dateLabel(date));button.setAttribute('aria-pressed',String(date===selected));
    if(date===S.dateKey(new Date()))button.classList.add('today');if(date===selected)button.classList.add('selected');
    const values=Object.values(days[date]||{});
    if(S.STARTS.some(m=>S.state(days[date],m,30,date)==='available'))button.classList.add('has-available');
    if(values.some(x=>x.status==='booked'))button.classList.add('has-booked');if(values.some(x=>x.status==='blocked'))button.classList.add('has-blocked');
    // Admin can inspect history; backend rejects changes to past times.
    button.onclick=()=>{selected=date;render();};const dot=document.createElement('i');dot.className='availability';button.append(dot);grid.append(button);
  }
  renderSlots();
  const bookings=new Map();Object.values(days).forEach(day=>Object.values(day).forEach(item=>{if(item.booking)bookings.set(item.booking.id,item.booking);}));
  const all=[...bookings.values()];$('todayCount').textContent=all.filter(b=>S.dateKey(S.instant(b.service_date,b.start_minute))===S.dateKey(new Date())).length;
  $('upcomingCount').textContent=all.filter(b=>S.instant(b.service_date,b.start_minute)>new Date()).length;
  $('blockedCount').textContent=Object.values(days).flatMap(Object.values).filter(x=>x.status==='blocked').length;
}
function renderSlots(){
  $('adminSlotsTitle').textContent=S.dateLabel(selected);
  $('adminPeriods').replaceChildren(...S.GROUPS.map(group=>{const button=document.createElement('button');button.type='button';button.role='tab';button.setAttribute('aria-selected',String(group.id===activeGroup));button.textContent=group.label;button.onclick=()=>{activeGroup=group.id;renderSlots();};return button;}));
  const group=S.GROUPS.find(g=>g.id===activeGroup),container=$('adminSlots');container.replaceChildren();
  for(const minute of S.STARTS.filter(m=>m>=group.from&&m<group.to)){
    const info=days[selected]?.[minute]||{status:'available'},booking=info.booking;
    const past=S.instant(selected,minute)<=new Date(),status=past&&!booking?'past':info.status;
    const row=document.createElement('div');row.className='slot '+status;
    const main=document.createElement('div');main.className='slot-main';main.innerHTML=`<div class="slot-time">${escapeHtml(S.localLabel(selected,minute,30))}</div><div class="slot-duration">30 minutes · IST${booking?` · part ${1+(minute-booking.start_minute)/30} of ${booking.duration_minutes/30}`:''}</div>`;
    if(booking){const details=document.createElement('div');details.className='booking-details';details.innerHTML=`<div class="booking-name">${escapeHtml(booking.name)}</div><div class="booking-contact">Role: ${escapeHtml(booking.interview_role)}</div><div class="booking-contact">Email: ${escapeHtml(booking.email)}</div><div class="booking-contact">WhatsApp: ${escapeHtml(booking.phone)}</div><div class="booking-contact">Full booking: ${escapeHtml(S.localLabel(booking.service_date,booking.start_minute,booking.duration_minutes))} · ${booking.duration_minutes} minutes</div><div class="booking-contact">Member time: ${escapeHtml(S.localLabel(booking.service_date,booking.start_minute,booking.duration_minutes,booking.customer_timezone))} · ${escapeHtml(booking.customer_timezone)}</div><div class="booking-contact">Company: ${escapeHtml(booking.company||'—')} · Round: ${escapeHtml(booking.interview_round||'—')}</div><div class="booking-contact">Notes: ${escapeHtml(booking.notes||'—')}</div>`;main.append(details);}
    const actions=document.createElement('div');actions.className='slot-actions';const label=document.createElement('span');label.className='slot-status';label.textContent=status.toUpperCase();actions.append(label);
    if(!past){const button=document.createElement('button');button.type='button';button.className='small-btn '+(status==='blocked'?'success':'danger');button.disabled=loading;
      if(booking){button.textContent='Release';button.onclick=()=>release(booking);}
      else{button.textContent=status==='blocked'?'Unblock':'Block';button.onclick=()=>block(minute,status==='blocked'?'available':'blocked');}actions.append(button);}
    row.append(main,actions);container.append(row);
  }
}
async function mutate(path,body){if(loading)return;loading=true;renderSlots();try{await api(path,{method:'POST',body:JSON.stringify(body)});await load();}catch(error){$('adminMessage').textContent=error.message;}finally{loading=false;renderSlots();}}
function block(minute,status){return mutate('admin-block',{date:selected,startMinute:minute,status});}
function release(booking){if(!confirm(`Cancel ${booking.name}'s ${booking.duration_minutes}-minute booking and release all its reserved slots?`))return;return mutate('admin-release',{id:booking.id});}
$('blockDay').onclick=()=>{if(confirm('Block all remaining available slots on this operating day? Existing bookings will stay reserved.'))mutate('admin-block',{date:selected,wholeDay:true,status:'blocked'});};
$('unblockDay').onclick=()=>mutate('admin-block',{date:selected,wholeDay:true,status:'available'});
$('loginForm').onsubmit=async event=>{event.preventDefault();const button=event.submitter;button.disabled=true;$('loginError').textContent='';try{const response=await fetch('/.netlify/functions/admin-login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:$('adminPassword').value})});const result=await response.json();if(!response.ok)throw new Error(result.error||'Login failed.');sessionStorage.setItem('interviewAdminToken',result.token);$('adminPassword').value='';await load();}catch(error){showLogin(error.message);}finally{button.disabled=false;}};
function changeMonth(offset){month.setMonth(month.getMonth()+offset);const earliest=S.currentServiceDate();selected=monthKey()===earliest.slice(0,7)?earliest:monthKey()+'-01';load();}
$('adminPrev').onclick=()=>changeMonth(-1);$('adminNext').onclick=()=>changeMonth(1);
$('adminLogout').onclick=()=>{sessionStorage.removeItem('interviewAdminToken');days={};showLogin();};
if(token())load();else showLogin();
