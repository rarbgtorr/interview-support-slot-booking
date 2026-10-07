let supabaseClient=null;
let pendingEmail=sessionStorage.getItem("interviewMemberPendingEmail")||"";
let resendTimer=null;

const $=id=>document.getElementById(id);
const loginCard=$("loginCard"),otpCard=$("otpCard"),dashboard=$("dashboard");
const setMessage=(el,text,type="")=>{el.textContent=text;el.className=`message ${type}`.trim()};

function formatLocalTime(row){return Schedule.localLabel(row.service_date,row.start_minute,row.duration_minutes,row.customer_timezone)}
function bookingInstant(row){return Schedule.instant(row.service_date,row.start_minute)}
function isUpcoming(row){return row.status==="booked"&&bookingInstant(row).getTime()>Date.now()}
function escapeHtml(v){return String(v??"").replace(/[&<>\"]/g,ch=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;"}[ch]))}
function dateLabel(date){return new Intl.DateTimeFormat("en-IN",{weekday:"long",day:"numeric",month:"long",year:"numeric",timeZone:"Asia/Kolkata"}).format(new Date(`${date}T00:00:00+05:30`))}
function unlockResend(seconds=60){
  const btn=$("resendOtpBtn");
  clearInterval(resendTimer);
  let left=seconds;
  btn.disabled=true;
  btn.textContent=`Resend OTP (${left}s)`;
  resendTimer=setInterval(()=>{
    left-=1;
    if(left<=0){clearInterval(resendTimer);btn.disabled=false;btn.textContent="Resend OTP"}
    else btn.textContent=`Resend OTP (${left}s)`;
  },1000);
}

function renderBooking(row,upcoming){
  const status=row.status==="booked"?"Confirmed":"Cancelled";
  return `<article class="booking-card ${row.status==="cancelled"?"cancelled":""}">
    <div class="booking-title">${escapeHtml(row.interview_role||"Interview support")}</div>
    <div class="booking-meta">
      <div>📅 <strong>${escapeHtml(dateLabel(Schedule.dateKey(bookingInstant(row),row.customer_timezone)))}</strong></div>
      <div>🕒 <strong>${escapeHtml(formatLocalTime(row))}</strong> · ${escapeHtml(row.customer_timezone||"")}</div>
      <div>${row.duration_minutes} minutes · ${row.duration_minutes/30} ${row.duration_minutes===30?"slot":"consecutive slots"}</div>
      <div>📱 ${escapeHtml(row.phone||"")}</div>
      <div>🎫 ${escapeHtml(row.id)}</div>
      <div>Status: <strong>${status}</strong></div>
    </div>
    ${upcoming?`<div class="booking-actions">
      <button class="danger" data-action="cancel" data-id="${escapeHtml(row.id)}">Cancel booking</button>
      <button class="reschedule" data-action="reschedule" data-id="${escapeHtml(row.id)}">Reschedule</button>
    </div>`:""}
  </article>`;
}

async function loadBookings(){
  const {data:{session}}=await supabaseClient.auth.getSession();
  if(!session){showLogin();return}
  $("memberEmail").textContent=session.user.email||"";
  const res=await fetch("/.netlify/functions/member-bookings",{headers:{Authorization:`Bearer ${session.access_token}`}});
  const body=await res.json().catch(()=>({}));
  if(res.status===401){await supabaseClient.auth.signOut();showLogin();return}
  if(!res.ok){setMessage($("dashboardMessage"),body.error||"Unable to load bookings.","error");return}
  const bookings=Array.isArray(body.bookings)?body.bookings:[];
  const upcoming=bookings.filter(isUpcoming).sort((a,b)=>bookingInstant(a)-bookingInstant(b));
  const history=bookings.filter(row=>!isUpcoming(row)).sort((a,b)=>bookingInstant(b)-bookingInstant(a));
  $("upcomingBookings").innerHTML=upcoming.length?upcoming.map(x=>renderBooking(x,true)).join(""):"<div class=\"empty\">You have no upcoming bookings.</div>";
  $("historyBookings").innerHTML=history.length?history.map(x=>renderBooking(x,false)).join(""):"<div class=\"empty\">No booking history yet.</div>";
}

function showDashboard(){loginCard.classList.add("hidden");otpCard.classList.add("hidden");dashboard.classList.remove("hidden");loadBookings().catch(error=>setMessage($("dashboardMessage"),error.message,"error"))}
function showLogin(){dashboard.classList.add("hidden");otpCard.classList.add("hidden");loginCard.classList.remove("hidden");clearInterval(resendTimer)}

async function init(){
  try{
    supabaseClient=await MemberAuth.client();
    supabaseClient.auth.onAuthStateChange((event,session)=>{
      if(session&&["SIGNED_IN","INITIAL_SESSION","TOKEN_REFRESHED"].includes(event))setTimeout(showDashboard,0);
      if(event==="SIGNED_OUT")showLogin();
    });
    const {data:{session}}=await supabaseClient.auth.getSession();
    if(session){showDashboard();return}
    if(pendingEmail){$("loginEmail").value=pendingEmail;$("otpEmail").textContent=pendingEmail;loginCard.classList.add("hidden");otpCard.classList.remove("hidden");unlockResend(0);$("otpCode").focus()}
  }catch(e){setMessage($("loginMessage"),e.message||"Unable to start member login.","error")}
}

$("emailForm").addEventListener("submit",async e=>{
  e.preventDefault();
  if(!supabaseClient)return;
  const email=$("loginEmail").value.trim().toLowerCase();
  const btn=$("sendOtpBtn");btn.disabled=true;btn.textContent="Sending OTP…";setMessage($("loginMessage"),"");
  try{
    const {error}=await supabaseClient.auth.signInWithOtp({email,options:{shouldCreateUser:true}});
    if(error)throw error;
    pendingEmail=email;sessionStorage.setItem("interviewMemberPendingEmail",email);
    $("otpEmail").textContent=email;loginCard.classList.add("hidden");otpCard.classList.remove("hidden");$("otpCode").value="";$("otpCode").focus();
    setMessage($("otpMessage"),"OTP sent. Check your email for the 6-digit code.","success");
    unlockResend(60);
  }catch(err){setMessage($("loginMessage"),err.message||"Unable to send OTP.","error")}
  finally{btn.disabled=false;btn.textContent="Send OTP"}
});

$("otpForm").addEventListener("submit",async e=>{
  e.preventDefault();
  if(!supabaseClient)return;
  const token=$("otpCode").value.trim();
  const email=pendingEmail||$("loginEmail").value.trim().toLowerCase();
  if(!/^\d{6}$/.test(token)){setMessage($("otpMessage"),"Enter the 6-digit verification code.","error");return}
  const btn=$("verifyOtpBtn");btn.disabled=true;btn.textContent="Verifying…";setMessage($("otpMessage"),"");
  try{
    const {data,error}=await supabaseClient.auth.verifyOtp({email,token,type:"email"});
    if(error)throw error;
    if(!data.session)throw new Error("Verification succeeded but no session was created.");
    sessionStorage.removeItem("interviewMemberPendingEmail");pendingEmail="";clearInterval(resendTimer);showDashboard();
  }catch(err){setMessage($("otpMessage"),err.message||"Invalid or expired OTP.","error")}
  finally{btn.disabled=false;btn.textContent="Verify OTP"}
});

$("resendOtpBtn").addEventListener("click",async()=>{
  if(!supabaseClient||!pendingEmail)return;
  const btn=$("resendOtpBtn");btn.disabled=true;
  try{
    const {error}=await supabaseClient.auth.signInWithOtp({email:pendingEmail,options:{shouldCreateUser:true}});
    if(error)throw error;
    $("otpCode").value="";$("otpCode").focus();setMessage($("otpMessage"),"A new OTP has been sent. Your previous code is no longer valid.","success");unlockResend(60);
  }catch(err){setMessage($("otpMessage"),err.message||"Unable to resend OTP.","error");btn.disabled=false;btn.textContent="Resend OTP"}
});

$("backToEmailBtn").addEventListener("click",()=>{pendingEmail="";sessionStorage.removeItem("interviewMemberPendingEmail");showLogin();$("loginEmail").value="";setMessage($("loginMessage"),"")});
$("logoutBtn").addEventListener("click",async()=>{if(supabaseClient)await supabaseClient.auth.signOut();sessionStorage.removeItem("interviewMemberPendingEmail");pendingEmail="";$("loginEmail").value="";showLogin()});

["upcomingBookings","historyBookings"].forEach(containerId=>$(containerId).addEventListener("click",async e=>{
  const button=e.target.closest("button[data-action]");if(!button)return;
  const id=button.dataset.id,action=button.dataset.action;
  if(action==="reschedule"){window.location.href="/?reschedule="+encodeURIComponent(id);return;}
  if(!window.confirm("Cancel this booking and release all its reserved slots?"))return;
  button.disabled=true;
  try{
    await MemberAuth.request("member-cancel",{method:"POST",body:JSON.stringify({id})});
    setMessage($("dashboardMessage"),"Your booking has been cancelled.","success");await loadBookings();
  }catch(error){setMessage($("dashboardMessage"),error.message,"error");button.disabled=false;}
}));
init();
