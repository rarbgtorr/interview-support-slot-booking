'use strict';
const S=Schedule,$=id=>document.getElementById(id);
const STAGES={new:'New customer',demo_booked:'Demo booked',demo_completed:'Demo completed',interested:'Interested',follow_up:'Follow-up needed',not_interested:'Not interested',interview_booked:'Interview booked',closed:'Closed'};
const STATUS={booked:'Booked',completed:'Completed',cancelled:'Cancelled',no_show:'No-show'};
const initial=S.currentServiceDate();
let customers=[],appointments=[],view='calendar',selectedDate=initial,calendarMonth=initial.slice(0,7),calendarGroup='morning';
let dataReady=false,busy=false,loadSequence=0,customerEditing=null,customerDirty=false,appointmentEditing=null,appointmentMinute=null,appointmentGroup='morning',requestId=null,pendingAppointment=null;
const monthSlots=new Map(),slotErrors=new Map(),slotRequests=new Map();
let slotGeneration=0;
function invalidateSlots(){slotGeneration++;monthSlots.clear();slotErrors.clear();slotRequests.clear();}
let displayZone=localStorage.getItem('supportDisplayTimezone')||S.TIMEZONE;
if(!S.validZone(displayZone))displayZone=S.TIMEZONE;
const token=()=>sessionStorage.getItem('interviewAdminToken');
const customerById=id=>customers.find(c=>c.id===id);
const appointmentById=id=>appointments.find(a=>a.id===id);
const esc=value=>String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
function empty(container,text){container.innerHTML='<p class="empty">'+esc(text)+'</p>';}
function message(text='',failure=false){$('appMessage').textContent=text;$('appMessage').classList.toggle('failure',failure);}
function zones(select,value){
  const list=[...new Set([S.TIMEZONE,value,...(Intl.supportedValuesOf?Intl.supportedValuesOf('timeZone'):['America/New_York','America/Chicago','America/Los_Angeles','Europe/London','Europe/Berlin','Asia/Dubai','Asia/Singapore','Australia/Sydney'])])];
  select.replaceChildren(...list.map(zone=>{const option=document.createElement('option');option.value=zone;option.textContent=zone===S.TIMEZONE?'India · Asia/Kolkata (IST)':zone.replaceAll('_',' ');return option;}));select.value=value;
}
function options(select,items){select.replaceChildren(...items.map(([value,label])=>{const o=document.createElement('option');o.value=value;o.textContent=label;return o;}));}
zones($('displayTimezone'),displayZone);zones($('customerTimezone'),S.TIMEZONE);zones($('appointmentTimezone'),S.TIMEZONE);
options($('customerStage'),Object.entries(STAGES));options($('stageFilter'),[['','All stages'],...Object.entries(STAGES)]);
async function api(path,options={}){
  if(!token())throw new Error('Please log in first.');
  const response=await fetch('/.netlify/functions/'+path,{...options,cache:'no-store',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token()}});
  let data;try{data=await response.json();}catch{throw new Error('The server returned an unreadable response. Please retry.');}
  if(response.status===401){logout('Your session expired. Please sign in again.');throw new Error(data.error||'Please sign in again.');}
  if(!response.ok)throw new Error(data.error||'Unable to complete request.');return data;
}
const post=(path,data)=>api(path,{method:'POST',body:JSON.stringify(data)});
function logout(error=''){
  loadSequence++;sessionStorage.removeItem('interviewAdminToken');customers=[];appointments=[];dataReady=false;invalidateSlots();
  for(const id of ['customerDialog','appointmentDialog'])if($(id).open)$(id).close();
  $('customerForm').reset();$('appointmentForm').reset();
  for(const id of ['customerList','todayAppointments','todayFollowups','calendarSlots','calendarAppointments','dueFollowups','upcomingFollowups','interestedCustomers','undatedFollowups','customerHistory','appointmentCustomer'])$(id).replaceChildren();
  $('adminApp').classList.add('hidden');$('loginCard').classList.remove('hidden');$('adminLogout').classList.add('hidden');$('refreshButton').classList.add('hidden');$('loginError').textContent=error;
}
async function loadData(){
  const sequence=++loadSequence;dataReady=false;setMainButtons();
  try{const data=await api('admin-data');if(sequence!==loadSequence||!token())return;customers=data.customers;appointments=data.appointments;dataReady=true;
    $('loginCard').classList.add('hidden');$('adminApp').classList.remove('hidden');$('adminLogout').classList.remove('hidden');$('refreshButton').classList.remove('hidden');
    render();await loadSlots(selectedDate.slice(0,7));
  }catch(error){if(token()){ $('loginCard').classList.add('hidden');$('adminApp').classList.remove('hidden');$('adminLogout').classList.remove('hidden');$('refreshButton').classList.remove('hidden');message(error.message,true);render();}}
  finally{setMainButtons();}
}
async function loadSlots(month){
  if(monthSlots.has(month)||!token())return;
  if(slotRequests.has(month))return slotRequests.get(month);
  const session=token(),generation=slotGeneration;slotErrors.delete(month);
  const request=(async()=>{
    try{const result=await api('admin-slots?month='+encodeURIComponent(month));if(token()===session&&generation===slotGeneration)monthSlots.set(month,result.days);}
    catch(error){if(token()===session&&generation===slotGeneration)slotErrors.set(month,error.message);}
    finally{if(slotRequests.get(month)===request)slotRequests.delete(month);if(token()===session){renderCalendar();if($('appointmentDialog').open)renderAppointmentSlots();}}
  })();slotRequests.set(month,request);return request;
}
function daySlots(date){return monthSlots.get(date.slice(0,7))?.[date]||{};}
function setMainButtons(){for(const id of ['newCustomerButton','quickDemoButton','quickInterviewButton'])$(id).disabled=busy||!dataReady;$('refreshButton').disabled=busy||!token();}
async function mutate(path,data){
  if(busy)throw new Error('A change is already being saved.');busy=true;setMainButtons();
  try{const result=await post(path,data);invalidateSlots();await loadData();return result;}
  finally{busy=false;setMainButtons();renderCalendar();}
}
function switchView(next){view=next;render();if(view==='calendar')loadSlots(calendarMonth);}
function render(){
  document.querySelectorAll('[data-view]').forEach(b=>{if(b.dataset.view===view)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current');});
  for(const [name,id] of Object.entries({today:'todayView',customers:'customersView',calendar:'calendarView',followups:'followupsView'}))$(id).classList.toggle('hidden',name!==view);
  renderToday();renderCustomers();renderFollowups();renderCalendar();
}
function sortedCustomers(list){return [...list].sort((a,b)=>a.name.localeCompare(b.name));}
function isDue(c){return c.follow_up_date&&c.follow_up_date<=S.dateKey(new Date());}
function customerRows(container,list,emptyText){
  container.replaceChildren();if(!list.length){empty(container,emptyText);return;}
  for(const c of list){const row=document.createElement('button');row.type='button';row.className='customer-row';
    const active=appointments.filter(a=>a.customer_id===c.id&&a.status==='booked').length;
    row.innerHTML=`<div class="customer-summary"><div class="customer-name">${esc(c.name)}</div><div class="customer-meta">${esc(c.phone)}${c.service_interest?' · '+esc(c.service_interest):''}</div><div class="customer-meta">${active} active appointment${active===1?'':'s'}</div></div><div class="customer-aside"><span class="badge ${esc(c.stage)}">${esc(STAGES[c.stage])}</span>${c.follow_up_date?`<div class="${isDue(c)?'due-label':'customer-meta'}">Follow-up ${esc(c.follow_up_date)}</div>`:''}</div>`;
    row.onclick=()=>openCustomer(c.id);container.append(row);
  }
}
function renderCustomers(){
  const query=$('customerSearch').value.trim().toLowerCase(),digits=query.replace(/\D/g,'');const stage=$('stageFilter').value;
  const list=sortedCustomers(customers.filter(c=>(!stage||c.stage===stage)&&(!query||c.name.toLowerCase().includes(query)||c.phone.toLowerCase().includes(query)||(digits&&c.phone_key.includes(digits)))));
  $('customerCount').textContent=String(customers.length);customerRows($('customerList'),list,'No matching customers. Add a customer to get started.');
}
function renderToday(){
  const serviceDate=S.currentServiceDate(),list=appointments.filter(a=>a.service_date===serviceDate&&a.status!=='cancelled');
  $('todayTitle').textContent=S.dateLabel(serviceDate);$('demoCount').textContent=list.filter(a=>a.booking_type==='demo').length;$('interviewCount').textContent=list.filter(a=>a.booking_type==='interview').length;
  const due=customers.filter(isDue).sort((a,b)=>a.follow_up_date.localeCompare(b.follow_up_date));$('followupCount').textContent=due.length;$('followupBadge').textContent=due.length;
  appointmentCards($('todayAppointments'),list,'No appointments this operating day. Book a demo or interview to add one.');customerRows($('todayFollowups'),due.slice(0,5),'No follow-ups due today.');
}
function renderFollowups(){
  const due=customers.filter(isDue).sort((a,b)=>a.follow_up_date.localeCompare(b.follow_up_date));
  const upcoming=customers.filter(c=>c.follow_up_date&&!isDue(c)).sort((a,b)=>a.follow_up_date.localeCompare(b.follow_up_date));
  const interested=customers.filter(c=>c.stage==='interested'&&!appointments.some(a=>a.customer_id===c.id&&a.booking_type==='interview'&&a.status==='booked'));
  customerRows($('dueFollowups'),due,'No due or overdue follow-ups.');customerRows($('upcomingFollowups'),upcoming,'No upcoming follow-ups.');customerRows($('interestedCustomers'),sortedCustomers(interested),'No interested customers awaiting an interview booking.');customerRows($('undatedFollowups'),sortedCustomers(customers.filter(c=>c.stage==='follow_up'&&!c.follow_up_date)),'Every follow-up customer has a date, or there are none yet.');
}
function appointmentCards(container,list,emptyText,inProfile=false){
  container.replaceChildren();if(!list.length){empty(container,emptyText);return;}
  for(const a of [...list].sort((a,b)=>new Date(a.starts_at)-new Date(b.starts_at))){
    const c=customerById(a.customer_id),card=document.createElement('article');card.className='appointment-card';
    card.innerHTML=`<div class="appointment-heading"><h3>${esc(c?.name||'Customer')}</h3><div><span class="badge ${esc(a.booking_type)}">${a.booking_type==='demo'?'Demo · 1 hour':'Interview · '+a.duration_minutes+' minutes'}</span> <span class="badge ${esc(a.status)}">${esc(STATUS[a.status])}</span></div></div><p class="appointment-time">${esc(S.localLabel(a.service_date,a.start_minute,a.duration_minutes,displayZone))}</p><div class="appointment-info">${esc(displayZone)}${a.timezone!==displayZone?'\nCustomer: '+S.localLabel(a.service_date,a.start_minute,a.duration_minutes,a.timezone)+' · '+a.timezone:''}${a.booking_type==='interview'?'\n'+[a.company,a.role,a.round].filter(Boolean).map(esc).join(' · '):''}${a.notes?'\nNotes: '+esc(a.notes):''}</div>`;
    const actions=document.createElement('div');actions.className='appointment-actions';
    const add=(text,fn,style='')=>{const b=document.createElement('button');b.type='button';b.textContent=text;b.className='small-btn '+style;b.disabled=busy||!dataReady;b.onclick=fn;actions.append(b);};
    if(!inProfile)add('Customer profile',()=>openCustomer(a.customer_id));
    if(a.status==='booked'){
      if(new Date(a.starts_at)>new Date())add('Reschedule',()=>openAppointment(a.booking_type,a.customer_id,a));
      if(new Date(a.ends_at)<=new Date())add('Mark completed',()=>setAppointmentStatus(a,'completed'),'success');
      if(new Date(a.starts_at)<=new Date())add('No-show',()=>setAppointmentStatus(a,'no_show'));
      add('Cancel',()=>setAppointmentStatus(a,'cancelled'),'danger');
    }
    card.append(actions);container.append(card);
  }
}
async function setAppointmentStatus(a,status){
  const question=status==='cancelled'?`Cancel this ${a.booking_type} and release its reserved slots?`:`Mark this ${a.booking_type} ${STATUS[status].toLowerCase()}?`;
  if(!confirm(question))return;
  try{await mutate('admin-appointment-status',{id:a.id,revision:a.revision,status});message('Appointment '+STATUS[status].toLowerCase()+'.');if($('customerDialog').open)openCustomer(a.customer_id);}
  catch(error){message(error.message,true);if($('customerDialog').open)$('customerError').textContent=error.message;}
}
function periodTabs(container,active,onChange){
  container.replaceChildren(...S.GROUPS.map(g=>{const b=document.createElement('button');b.type='button';b.role='tab';b.setAttribute('aria-selected',String(g.id===active));b.tabIndex=g.id===active?0:-1;b.textContent=g.label;
    b.onclick=()=>onChange(g.id);b.onkeydown=e=>{if(!['ArrowLeft','ArrowRight'].includes(e.key))return;e.preventDefault();const index=(S.GROUPS.indexOf(g)+(e.key==='ArrowRight'?1:3))%4;onChange(S.GROUPS[index].id);container.children[index].focus();};return b;}));
}
function calendarDuration(){return $('calendarType').value==='demo'?60:Number($('calendarDuration').value);}
function renderCalendar(){
  $('calendarMonth').textContent=new Intl.DateTimeFormat('en-IN',{month:'long',year:'numeric',timeZone:'UTC'}).format(new Date(calendarMonth+'-01T12:00:00Z'));$('calendarTitle').textContent=S.dateLabel(selectedDate);
  const first=new Date(calendarMonth+'-01T12:00:00Z'),count=new Date(Date.UTC(first.getUTCFullYear(),first.getUTCMonth()+1,0)).getUTCDate(),grid=$('calendarGrid');grid.replaceChildren();
  for(let i=0;i<first.getUTCDay();i++)grid.append(document.createElement('span'));
  const ready=dataReady&&monthSlots.has(calendarMonth);
  for(let i=1;i<=count;i++){
    const date=calendarMonth+'-'+String(i).padStart(2,'0'),b=document.createElement('button');b.type='button';b.className='day';b.textContent=i;b.setAttribute('aria-label',S.dateLabel(date));b.setAttribute('aria-pressed',String(date===selectedDate));
    if(date===S.dateKey(new Date()))b.classList.add('today');if(date===selectedDate)b.classList.add('selected');
    if(ready){const rows=daySlots(date);if(S.STARTS.some(m=>S.state(rows,m,30,date)==='available'))b.classList.add('has-available');if(Object.values(rows).some(r=>r.status==='booked'))b.classList.add('has-booked');if(Object.values(rows).some(r=>r.status==='blocked'))b.classList.add('has-blocked');}
    const dot=document.createElement('i');dot.className='availability';b.append(dot);b.onclick=()=>{selectedDate=date;renderCalendar();if(innerWidth<700)$('calendarSlots').scrollIntoView({behavior:'smooth',block:'start'});};grid.append(b);
  }
  $('calendarDurationLabel').classList.toggle('hidden',$('calendarType').value==='demo');
  periodTabs($('calendarPeriods'),calendarGroup,g=>{calendarGroup=g;renderCalendar();});
  const container=$('calendarSlots');container.replaceChildren();$('blockDay').disabled=!ready||busy;$('unblockDay').disabled=!ready||busy;
  $('calendarMessage').textContent=slotErrors.get(calendarMonth)||(ready?'Labels use '+displayZone+'. The time groups follow IST operating hours.':'Loading availability…');
  if(!ready){empty(container,slotErrors.get(calendarMonth)?'Availability could not be loaded. Use Refresh to retry.':'Checking availability before showing bookable slots.');}
  else{
    const group=S.GROUPS.find(g=>g.id===calendarGroup),duration=calendarDuration();
    for(const m of S.STARTS.filter(m=>m>=group.from&&m<group.to&&m+duration<=S.END)){
      const slots=daySlots(selectedDate),own=slots[m],state=S.state(slots,m,duration,selectedDate),a=appointmentById(own?.appointmentId);
      const row=document.createElement('div');row.className='slot calendar-slot '+state+(a?' appointment-'+a.booking_type:'');
      row.innerHTML=`<div class="slot-main"><div class="slot-time">${esc(S.localLabel(selectedDate,m,duration,displayZone))}</div><div class="slot-duration">${duration} minutes${a?' · '+esc(customerById(a.customer_id)?.name||'Customer')+' · '+esc(a.booking_type):''}</div></div>`;
      const actions=document.createElement('div');actions.className='slot-actions';const label=document.createElement('span');label.className='slot-status';label.textContent=state==='past'?'Unavailable':state;actions.append(label);
      const add=(text,fn,disabled=false)=>{const b=document.createElement('button');b.type='button';b.className='small-btn';b.textContent=text;b.disabled=busy||disabled;b.onclick=fn;actions.append(b);};
      if(a)add('View booking',()=>openCustomer(a.customer_id));
      if(state==='available')add('Book',()=>openAppointment($('calendarType').value,null,null,{date:selectedDate,minute:m,duration}));
      if(S.instant(selectedDate,m)>new Date()&&own?.status!=='booked')add(own?.status==='blocked'?'Unblock':'Block',()=>blockSlot(m,own?.status==='blocked'?'available':'blocked'));
      row.append(actions);container.append(row);
    }
  }
  appointmentCards($('calendarAppointments'),appointments.filter(a=>a.service_date===selectedDate),'No appointments on this operating day.');
}
async function blockSlot(minute,status,wholeDay=false){try{await mutate('admin-block',{date:selectedDate,startMinute:minute,status,wholeDay});message(status==='blocked'?'Availability blocked.':'Availability unblocked.');}catch(error){message(error.message,true);}}
function openCustomer(id=null){
  if(!dataReady||busy)return;if($('appointmentDialog').open)$('appointmentDialog').close();
  customerEditing=id?customerById(id):null;customerDirty=false;const c=customerEditing;
  $('customerForm').reset();$('customerDialogTitle').textContent=c?c.name:'Add customer';$('customerName').value=c?.name||'';$('customerPhone').value=c?.phone||'';$('customerService').value=c?.service_interest||'';zones($('customerTimezone'),c?.timezone||S.TIMEZONE);$('customerStage').value=c?.stage||'new';$('customerFollowUp').value=c?.follow_up_date||'';$('customerNotes').value=c?.notes||'';$('customerError').textContent='';$('saveCustomerButton').disabled=false;
  $('customerProfileActions').classList.toggle('hidden',!c);$('customerHistorySection').classList.toggle('hidden',!c);$('profileDemo').disabled=false;$('profileInterview').disabled=false;
  $('profileHint').textContent='';
  if(c)appointmentCards($('customerHistory'),appointments.filter(a=>a.customer_id===c.id),'No appointments yet. Book their first demo.',true);
  if(!$('customerDialog').open)$('customerDialog').showModal();
}
function customerPayload(){return {name:$('customerName').value,phone:$('customerPhone').value,serviceInterest:$('customerService').value,timezone:$('customerTimezone').value,stage:$('customerStage').value,followUpDate:$('customerFollowUp').value,notes:$('customerNotes').value,...(customerEditing?{id:customerEditing.id,revision:customerEditing.revision}:{})};}
$('customerForm').oninput=()=>{customerDirty=true;$('customerHistory').querySelectorAll('button').forEach(b=>b.disabled=true);if(customerEditing){$('profileDemo').disabled=true;$('profileInterview').disabled=true;$('profileHint').textContent='Save your changes before booking an appointment.';}};
$('customerForm').onsubmit=async event=>{
  event.preventDefault();if(busy)return;const b=$('saveCustomerButton');b.disabled=true;$('customerError').textContent='';
  try{const result=await mutate('admin-customers',customerPayload());message('Customer saved.');$('customerDialog').close();if(pendingAppointment){const pending=pendingAppointment;pendingAppointment=null;openAppointment(pending.type,result.customer.id,null,pending.prefill);}else openCustomer(result.customer.id);}
  catch(error){$('customerError').textContent=error.message;}finally{b.disabled=false;}
};
function openAppointment(type='demo',customerId=null,existing=null,prefill={}){
  if(!dataReady||busy)return;if($('customerDialog').open)$('customerDialog').close();
  appointmentEditing=existing;appointmentMinute=existing?.start_minute??prefill.minute??null;appointmentGroup=appointmentMinute===null?'morning':S.groupFor(appointmentMinute).id;requestId=crypto.randomUUID();
  $('appointmentForm').reset();options($('appointmentCustomer'),[['','Enter customer details below'],...sortedCustomers(customers).map(c=>[c.id,c.name+' · '+c.phone])]);$('appointmentCustomer').value=customerId||'';$('appointmentCustomer').disabled=!!existing;$('appointmentType').value=type;$('appointmentType').disabled=!!existing;$('directCustomerFields').classList.toggle('hidden',!!customerId);for(const id of ['bookingName','bookingPhone','bookingService'])$(id).disabled=!!customerId;
  const c=customerById(customerId);zones($('appointmentTimezone'),existing?.timezone||c?.timezone||S.TIMEZONE);$('appointmentDate').value=existing?.service_date||prefill.date||selectedDate;$('appointmentDate').min=S.currentServiceDate();$('appointmentDuration').value=String(type==='demo'?60:existing?.duration_minutes||prefill.duration||30);
  $('appointmentCompany').value=existing?.company||'';$('appointmentRole').value=existing?.role||'';$('appointmentRound').value=existing?.round||'';$('appointmentNotes').value=existing?.notes||'';$('appointmentError').textContent='';syncAppointmentType();
  $('appointmentDialog').showModal();loadSlots($('appointmentDate').value.slice(0,7));
}
function syncAppointmentType(){
  const type=$('appointmentType').value;$('appointmentDialogTitle').textContent=(appointmentEditing?'Reschedule ':'Book ')+type;
  $('appointmentDuration').disabled=type==='demo';if(type==='demo')$('appointmentDuration').value='60';$('interviewFields').classList.toggle('hidden',type!=='interview');
  const c=customerById($('appointmentCustomer').value),eligible=!!c||!$('appointmentCustomer').value;
  $('appointmentCustomerHint').textContent=!c?'Enter the name and phone number below. The customer record is saved with this appointment.':c.phone+' · '+STAGES[c.stage];renderAppointmentSlots();
}
function renderAppointmentSlots(){
  const date=$('appointmentDate').value,month=date.slice(0,7),duration=Number($('appointmentDuration').value),zone=$('appointmentTimezone').value,type=$('appointmentType').value;
  const c=customerById($('appointmentCustomer').value),eligible=!!c||!$('appointmentCustomer').value;
  const ready=dataReady&&S.validDate(date)&&monthSlots.has(month),slots=daySlots(date),group=S.GROUPS.find(g=>g.id===appointmentGroup);
  periodTabs($('appointmentPeriods'),appointmentGroup,g=>{appointmentGroup=g;renderAppointmentSlots();});$('appointmentSlots').replaceChildren();
  $('appointmentAvailabilityMessage').textContent=slotErrors.get(month)||(!ready?'Loading availability…':appointmentEditing?'Your original reservation stays booked until the replacement is saved.':'Choose a green available slot.');
  if(ready){for(const minute of S.STARTS.filter(m=>m>=group.from&&m<group.to&&m+duration<=S.END)){
    const state=S.state(slots,minute,duration,date,Date.now(),appointmentEditing?.id),b=document.createElement('button');b.type='button';b.className='slot '+state+(minute===appointmentMinute?' selected':'');b.disabled=state!=='available'||busy;
    b.innerHTML=`<div><div class="slot-time">${esc(S.localLabel(date,minute,duration,zone))}</div><div class="slot-duration">${duration} minutes · ${minute===appointmentMinute?'Selected':state}</div></div><span class="slot-status">${minute===appointmentMinute?'✓':state}</span>`;
    b.onclick=()=>{appointmentMinute=minute;requestId=crypto.randomUUID();renderAppointmentSlots();};$('appointmentSlots').append(b);
  }}else empty($('appointmentSlots'),slotErrors.get(month)?'Unable to load availability. Close this form and use Refresh.':'Checking availability…');
  const valid=ready&&appointmentMinute!==null&&S.state(slots,appointmentMinute,duration,date,Date.now(),appointmentEditing?.id)==='available';
  $('appointmentSelection').textContent=valid?'Selected: '+S.localLabel(date,appointmentMinute,duration,zone)+' · '+zone:'Select an available slot to continue.';$('saveAppointmentButton').disabled=busy||!valid||!eligible;
}
$('appointmentForm').onsubmit=async event=>{
  event.preventDefault();if(busy||appointmentMinute===null)return;$('appointmentError').textContent='';$('saveAppointmentButton').disabled=true;
  const payload={customerId:$('appointmentCustomer').value||null,customer:{name:$('bookingName').value,phone:$('bookingPhone').value,serviceInterest:$('bookingService').value},type:$('appointmentType').value,duration:Number($('appointmentDuration').value),date:$('appointmentDate').value,startMinute:appointmentMinute,timezone:$('appointmentTimezone').value,company:$('appointmentCompany').value,role:$('appointmentRole').value,round:$('appointmentRound').value,notes:$('appointmentNotes').value,requestId,...(appointmentEditing?{id:appointmentEditing.id,revision:appointmentEditing.revision}:{})};
  try{const result=await mutate('admin-appointments',payload);$('appointmentDialog').close();selectedDate=result.appointment.service_date;calendarMonth=selectedDate.slice(0,7);calendarGroup=S.groupFor(result.appointment.start_minute).id;message((appointmentEditing?'Appointment rescheduled.':'Appointment booked.')+' No notification was sent.');render();}
  catch(error){$('appointmentError').textContent=error.message;monthSlots.delete(payload.date.slice(0,7));await loadSlots(payload.date.slice(0,7));}finally{if($('appointmentDialog').open)renderAppointmentSlots();}
};
$('appointmentForm').oninput=()=>{requestId=crypto.randomUUID();};
$('appointmentCustomer').onchange=()=>{const c=customerById($('appointmentCustomer').value);$('directCustomerFields').classList.toggle('hidden',!!c);for(const id of ['bookingName','bookingPhone','bookingService'])$(id).disabled=!!c;if(c)zones($('appointmentTimezone'),c.timezone);syncAppointmentType();};
$('appointmentType').onchange=()=>{appointmentMinute=null;syncAppointmentType();};$('appointmentDuration').onchange=()=>{renderAppointmentSlots();};$('appointmentTimezone').onchange=()=>renderAppointmentSlots();
$('appointmentDate').onchange=()=>{appointmentMinute=null;renderAppointmentSlots();if(S.validDate($('appointmentDate').value))loadSlots($('appointmentDate').value.slice(0,7));};
$('profileDemo').onclick=()=>openAppointment('demo',customerEditing.id);$('profileInterview').onclick=()=>openAppointment('interview',customerEditing.id);
$('newCustomerButton').onclick=()=>switchView('customers');$('quickDemoButton').onclick=()=>openAppointment('demo');$('quickInterviewButton').onclick=()=>openAppointment('interview');
$('customerSearch').oninput=renderCustomers;$('stageFilter').onchange=renderCustomers;
$('displayTimezone').onchange=()=>{displayZone=$('displayTimezone').value;localStorage.setItem('supportDisplayTimezone',displayZone);render();if($('customerDialog').open&&customerEditing)appointmentCards($('customerHistory'),appointments.filter(a=>a.customer_id===customerEditing.id),'No appointments yet.',true);};
$('calendarType').onchange=renderCalendar;$('calendarDuration').onchange=renderCalendar;
function moveMonth(offset){const d=new Date(calendarMonth+'-01T12:00:00Z');d.setUTCMonth(d.getUTCMonth()+offset);calendarMonth=d.toISOString().slice(0,7);selectedDate=calendarMonth+'-01';renderCalendar();loadSlots(calendarMonth);}
$('calendarPrev').onclick=()=>moveMonth(-1);$('calendarNext').onclick=()=>moveMonth(1);
$('blockDay').onclick=()=>{if(confirm('Block all future available half-hours on this operating day? Existing appointments will stay booked.'))blockSlot(null,'blocked',true);};$('unblockDay').onclick=()=>blockSlot(null,'available',true);
$('openCalendarButton').onclick=()=>{selectedDate=S.currentServiceDate();calendarMonth=selectedDate.slice(0,7);switchView('calendar');};
document.querySelectorAll('[data-view]').forEach(b=>b.onclick=()=>switchView(b.dataset.view));
document.querySelectorAll('[data-close]').forEach(b=>b.onclick=()=>{$(b.dataset.close).close();if(b.dataset.close==='customerDialog')pendingAppointment=null;});
$('customerDialog').addEventListener('cancel',()=>{pendingAppointment=null;});
$('adminLogout').onclick=()=>logout();$('refreshButton').onclick=()=>{message();invalidateSlots();loadData();};
$('loginForm').onsubmit=async event=>{
  event.preventDefault();const b=event.submitter;b.disabled=true;$('loginError').textContent='';
  try{const response=await fetch('/.netlify/functions/admin-login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:$('adminPassword').value})});const data=await response.json();if(!response.ok)throw new Error(data.error||'Login failed.');sessionStorage.setItem('interviewAdminToken',data.token);$('adminPassword').value='';await loadData();}
  catch(error){$('loginError').textContent=error.message;}finally{b.disabled=false;}
};
setInterval(()=>{if(dataReady&&!busy){renderToday();if(view==='calendar')renderCalendar();if($('appointmentDialog').open)renderAppointmentSlots();}},60000);
if(token())loadData();else logout();
