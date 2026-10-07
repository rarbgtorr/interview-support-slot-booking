'use strict';
const S=Schedule, $=id=>document.getElementById(id);
const iso=d=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
const dateObject=key=>new Date(key+'T12:00:00');
let selectedDate=S.currentServiceDate(), currentMonth=dateObject(selectedDate);
currentMonth.setDate(1);
let duration=30, activeGroup='morning', days={}, loaded=false, loading=false, loadSequence=0;
let selection=null, submitting=false, ownBooking=null, bookingRequestId=null;
const rescheduleId=new URLSearchParams(location.search).get('reschedule');
const escapeHtml=value=>String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
function monthKey(){return iso(currentMonth).slice(0,7);}
function state(minute,date=selectedDate) {
  const day={...(days[date]||{})};
  if(ownBooking&&ownBooking.service_date===date) {
    for(let m=ownBooking.start_minute;m<ownBooking.start_minute+ownBooking.duration_minutes;m+=30)delete day[m];
  }
  return S.state(day,minute,duration,date);
}
function eligible(minute,date=selectedDate){return minute+duration<=S.END&&state(minute,date)==='available';}
function availableForGroup(group){return S.STARTS.filter(m=>m>=group.from&&m<group.to&&eligible(m));}
function setupTimezone() {
  let zones=[];
  try{zones=Intl.supportedValuesOf('timeZone');}catch{}
  const detected=S.normalizeZone(Intl.DateTimeFormat().resolvedOptions().timeZone||S.TIMEZONE);
  zones=[...new Set([...zones.map(S.normalizeZone),S.TIMEZONE,detected])].filter(S.validZone).sort();
  let saved;try{saved=localStorage.getItem('interviewSlotTimezone');}catch{}
  $('timezoneSelect').replaceChildren(...zones.map(zone=>{const option=document.createElement('option');option.value=zone;option.textContent=zone;return option;}));
  $('timezoneSelect').value=zones.includes(saved)?saved:detected;
  $('timezoneSelect').onchange=()=>{try{localStorage.setItem('interviewSlotTimezone',$('timezoneSelect').value);}catch{}renderSlots();};
}
function renderCalendar() {
  $('monthLabel').textContent=currentMonth.toLocaleDateString('en-IN',{month:'long',year:'numeric'});
  $('selectedDateLabel').textContent=S.dateLabel(selectedDate);
  const today=S.currentServiceDate();
  $('prevMonth').disabled=monthKey()<=today.slice(0,7);
  const grid=$('calendarGrid');grid.replaceChildren();
  for(let i=0;i<currentMonth.getDay();i++){const blank=document.createElement('span');blank.className='day muted';grid.append(blank);}
  const last=new Date(currentMonth.getFullYear(),currentMonth.getMonth()+1,0).getDate();
  for(let n=1;n<=last;n++){
    const key=`${monthKey()}-${String(n).padStart(2,'0')}`;
    const button=document.createElement('button');button.type='button';button.className='day';button.textContent=n;
    button.setAttribute('aria-label',S.dateLabel(key));button.setAttribute('aria-pressed',String(key===selectedDate));
    if(key===S.dateKey(new Date()))button.classList.add('today');
    if(key===selectedDate)button.classList.add('selected');
    if(key<today){button.disabled=true;button.classList.add('muted');}
    else{
      if(loaded&&S.STARTS.some(m=>eligible(m,key)))button.classList.add('has-available');
      if(Object.values(days[key]||{}).some(x=>x==='booked'))button.classList.add('has-booked');
      button.onclick=()=>{selectedDate=key;renderCalendar();renderSlots(true);};
    }
    const dot=document.createElement('i');dot.className='availability';button.append(dot);grid.append(button);
  }
}
function renderSlots(autoGroup=false) {
  const zone=$('timezoneSelect').value;
  $('timezoneLabel').textContent='Showing times in '+zone;
  $('timezoneHint').textContent='';
  $('slotsTitle').textContent='Available slots';
  $('slotDatePill').textContent=new Date(selectedDate+'T12:00:00Z').toLocaleDateString('en-IN',{day:'numeric',month:'short',timeZone:'UTC'})+' · IST day';
  if(autoGroup&&loaded&&!availableForGroup(S.GROUPS.find(g=>g.id===activeGroup)).length)activeGroup=S.GROUPS.find(g=>availableForGroup(g).length)?.id||activeGroup;
  $('periodTabs').replaceChildren(...S.GROUPS.map(group=>{
    const button=document.createElement('button');button.type='button';button.id='period-'+group.id;button.role='tab';button.setAttribute('aria-controls','slots');button.setAttribute('aria-selected',String(group.id===activeGroup));
    button.innerHTML=`${group.label}<small>${loaded?availableForGroup(group).length:'—'} available</small>`;
    button.onclick=()=>{activeGroup=group.id;renderSlots();};return button;
  }));
  $('slots').setAttribute('aria-labelledby','period-'+activeGroup);
  const container=$('slots');container.replaceChildren();
  if(!loaded){if(loading)$('availabilityMessage').textContent='Loading availability…';return;}
  const group=S.GROUPS.find(g=>g.id===activeGroup);
  const count=availableForGroup(group).length;
  $('availabilityMessage').textContent=`${group.label}: ${count} available ${duration}-minute start ${count===1?'time':'times'}.`;
  const starts=S.STARTS.filter(m=>m>=group.from&&m<group.to&&m+duration<=S.END);
  for(const minute of starts){
    const status=state(minute), publicStatus=status==='blocked'?'booked':status;
    const button=document.createElement('button');button.type='button';button.className='slot '+publicStatus;button.disabled=publicStatus!=='available'||(Boolean(rescheduleId)&&!ownBooking);
    const label=S.localLabel(selectedDate,minute,duration,zone);
    button.innerHTML=`<div><div class="slot-time">${escapeHtml(label)}</div><div class="slot-duration">${duration} minutes · ${duration/30} ${duration===30?'slot':'consecutive slots'}</div></div><span class="slot-status">${publicStatus==='past'?'PAST':publicStatus==='available'?'AVAILABLE':'UNAVAILABLE'}</span>`;
    button.onclick=()=>openBooking(minute);container.append(button);
  }
  if(!count){const empty=document.createElement('p');empty.className='empty';empty.textContent='No available times in this group. Try another group or date.';container.prepend(empty);}
}
async function loadMonth(autoGroup=true) {
  const sequence=++loadSequence;loaded=false;loading=true;renderCalendar();renderSlots();
  try{
    const response=await fetch('/.netlify/functions/slots?month='+monthKey(),{cache:'no-store'});
    const body=await response.json();if(!response.ok)throw new Error(body.error||'Unable to load availability.');
    if(sequence!==loadSequence)return;days=body;loaded=true;loading=false;renderCalendar();renderSlots(autoGroup);
  }catch(error){if(sequence!==loadSequence)return;loaded=false;loading=false;days={};renderCalendar();renderSlots();$('availabilityMessage').textContent=error.message+' ';const retry=document.createElement('button');retry.className='small-btn';retry.textContent='Retry';retry.onclick=()=>loadMonth();$('availabilityMessage').append(retry);}
}
function openBooking(minute) {
  if(!loaded||!eligible(minute)||submitting)return;
  selection={date:selectedDate,minute,duration,timezone:$('timezoneSelect').value};
  bookingRequestId=crypto.randomUUID();
  $('bookingForm').reset();
  if(ownBooking){for(const [id,key] of [['name','name'],['email','email'],['phone','phone'],['interviewRole','interview_role'],['company','company'],['interviewRound','interview_round'],['notes','notes']])$(id).value=ownBooking[key]||'';}
  $('email').readOnly=Boolean(ownBooking);
  $('modalSlot').textContent=S.localLabel(selection.date,minute,duration,selection.timezone);
  $('bookingSlotDisplay').value=$('modalSlot').textContent;
  $('bookingTimezoneDisplay').value=selection.timezone;
  $('bookingError').textContent='';$('bookingProgress').textContent='';
  $('confirmBookingBtn').textContent=ownBooking?'Confirm reschedule':'Confirm booking';
  $('bookingModal').classList.remove('hidden');$('interviewRole').focus();
}
function closeBooking(){if(submitting)return;$('bookingModal').classList.add('hidden');selection=null;}
document.querySelectorAll('[data-close]').forEach(button=>button.onclick=closeBooking);
document.addEventListener('keydown',event=>{
  if(event.key==='Escape')closeBooking();
  if(event.key==='Tab'&&!$('bookingModal').classList.contains('hidden')){
    const nodes=[...$('bookingModal').querySelectorAll('button,input:not([type=hidden]),textarea')].filter(x=>!x.disabled);
    const first=nodes[0],last=nodes[nodes.length-1];
    if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}
    if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}
  }
});
$('durationOptions').onclick=event=>{
  const button=event.target.closest('[data-duration]');if(!button)return;
  duration=Number(button.dataset.duration);
  document.querySelectorAll('[data-duration]').forEach(x=>x.setAttribute('aria-pressed',String(Number(x.dataset.duration)===duration)));
  renderCalendar();renderSlots();
};
$('periodTabs').onkeydown=event=>{
  if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;
  event.preventDefault();let index=S.GROUPS.findIndex(g=>g.id===activeGroup);
  index=event.key==='Home'?0:event.key==='End'?3:(index+(event.key==='ArrowRight'?1:3))%4;
  activeGroup=S.GROUPS[index].id;renderSlots();$('period-'+activeGroup).focus();
};
function changeMonth(offset) {
  currentMonth.setMonth(currentMonth.getMonth()+offset);
  const first=iso(currentMonth), earliest=S.currentServiceDate();
  selectedDate=first.slice(0,7)===earliest.slice(0,7)?earliest:first;loadMonth();
}
$('prevMonth').onclick=()=>changeMonth(-1);$('nextMonth').onclick=()=>changeMonth(1);
$('bookingForm').onsubmit=async event=>{
  event.preventDefault();if(submitting||!selection)return;
  const payload={date:selection.date,startMinute:selection.minute,duration:selection.duration,timezone:selection.timezone,requestId:bookingRequestId,name:$('name').value.trim(),email:$('email').value.trim(),phone:$('phone').value.trim(),interviewRole:$('interviewRole').value.trim(),company:$('company').value.trim(),interviewRound:$('interviewRound').value.trim(),notes:$('notes').value.trim()};
  submitting=true;$('confirmBookingBtn').disabled=true;$('bookingError').textContent='';$('bookingProgress').textContent='Checking availability and reserving your time…';
  try{
    let body;
    if(ownBooking)body=await MemberAuth.request('member-reschedule',{method:'POST',body:JSON.stringify({...payload,id:ownBooking.id})});
    else{const response=await fetch('/.netlify/functions/book',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});body=await response.json();if(!response.ok){if(response.status===409){bookingRequestId=crypto.randomUUID();loadMonth(false);}throw new Error(body.error||'Unable to reserve your time.');}}
    $('bookingModal').classList.add('hidden');
    const booking=body.booking;
    $('successDetails').innerHTML=`<b>${escapeHtml(booking.interview_role)}</b><br>${escapeHtml(S.localLabel(booking.service_date,booking.start_minute,booking.duration_minutes,booking.customer_timezone))}<br>${booking.duration_minutes} minutes<br>Time zone: ${escapeHtml(booking.customer_timezone)}<br>Booking ID: <b>${escapeHtml(booking.id)}</b><br><small>${body.notifications?.member?'Confirmation email sent.':'Your booking is saved. Keep this booking ID; email confirmation may be delayed or unavailable.'}</small><br><a class="admin-link" href="/member">Manage my bookings</a>`;
    $('successModal').classList.remove('hidden');selection=null;
    if(ownBooking){ownBooking=booking;$('rescheduleText').textContent='Your booking has been rescheduled.';}
    await loadMonth(false);
  }catch(error){$('bookingError').textContent=error.message;$('bookingProgress').textContent='';}
  finally{submitting=false;$('confirmBookingBtn').disabled=false;$('confirmBookingBtn').textContent=ownBooking?'Confirm reschedule':'Confirm booking';}
};
$('successClose').onclick=()=>{if(rescheduleId){location.href='/member';return;}$('successModal').classList.add('hidden');};
async function init(){
  setupTimezone();
  if(rescheduleId){
    $('rescheduleNotice').classList.remove('hidden');$('rescheduleText').textContent='Loading your booking…';
    try{
      const {bookings}=await MemberAuth.request('member-bookings');
      ownBooking=bookings.find(b=>b.id===rescheduleId&&b.status==='booked');
      if(!ownBooking||S.instant(ownBooking.service_date,ownBooking.start_minute)<=new Date())throw new Error('This booking cannot be rescheduled. Return to My bookings.');
      duration=ownBooking.duration_minutes;selectedDate=ownBooking.service_date;currentMonth=dateObject(selectedDate);currentMonth.setDate(1);
      if(S.validZone(ownBooking.customer_timezone))$('timezoneSelect').value=ownBooking.customer_timezone;
      activeGroup=S.groupFor(ownBooking.start_minute).id;
      document.querySelectorAll('[data-duration]').forEach(x=>x.setAttribute('aria-pressed',String(Number(x.dataset.duration)===duration)));
      $('rescheduleText').textContent='Choose a replacement time. Your current booking stays reserved until the change is confirmed.';
    }catch(error){ownBooking=null;$('rescheduleText').textContent=error.message;}
  }
  await loadMonth();
  try{const key=S.dateKey(new Date());if(localStorage.getItem('interviewVisitorDate')!==key){const result=await fetch('/.netlify/functions/visitor-track',{method:'POST'});if(result.ok)localStorage.setItem('interviewVisitorDate',key);}}catch{}
}
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'&&!submitting)loadMonth(false);});
setInterval(()=>{if(document.visibilityState==='visible'&&loaded&&!submitting){renderCalendar();renderSlots();}},30000);
init();
