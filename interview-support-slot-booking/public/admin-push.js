'use strict';
(()=>{
 const el=id=>document.getElementById(id),supported=isSecureContext&&'serviceWorker' in navigator&&'PushManager' in window&&'Notification' in window;
 let active=false,busy=false,epoch=0,status=null,registration=null,subscription=null,lastLoad=0,intent=false,permissionWatch=null;
 const current=()=>status?.devices?.find(device=>device.current);
 const call=data=>api('admin-push',{method:'POST',body:JSON.stringify(data)});
 function note(text,error=false){el('pushMessage').textContent=text;el('pushMessage').classList.toggle('error',error);}
 function render(){
  const device=current(),granted=supported&&Notification.permission==='granted';
  el('pushState').textContent=!supported?'Not supported':device&&granted?'Enabled':device?'Permission blocked':'Not enabled';
  el('pushDeviceCount').textContent=(status?.devices?.length||0)+' of 2 devices enabled';
  el('enablePush').classList.toggle('hidden',!!device&&granted);el('disablePush').classList.toggle('hidden',!device);
  el('enablePush').disabled=busy||!supported||!status?.publicKey;el('testPush').disabled=busy||!device||!granted;
  el('disablePush').disabled=busy;el('refreshPush').disabled=busy;
  el('pushDevices').replaceChildren(...(status?.devices||[]).map(row=>{const item=document.createElement('div');item.className='selected-slot';const name=document.createElement('span');name.textContent=row.label+(row.current?' · This phone':'');const button=document.createElement('button');button.type='button';button.className='quiet';button.textContent='Disable';button.disabled=busy;button.onclick=()=>disable(row);item.append(name,button);return item;}));
 }
 async function refresh(force=false){
  if(!active||busy||(!force&&Date.now()-lastLoad<30000))return;const stamp=epoch;busy=true;render();
  try{
   if(supported){registration=await navigator.serviceWorker.register('/admin-reminders-sw.js',{scope:'/admin',updateViaCache:'none'});await navigator.serviceWorker.ready;subscription=await registration.pushManager.getSubscription();}
   if(stamp!==epoch||!active)return;
   const data=await call({action:'status',endpoint:subscription?.endpoint||null});if(stamp!==epoch||!active)return;
   status=data;lastLoad=Date.now();
   if(!supported)note('Open the admin page in Chrome on your Android phone to enable reminders.');
   else if(Notification.permission==='denied')note('Allow notifications in Chrome’s site settings, then return here.');
   else note(current()?'Booking alerts and reminders are enabled on this phone.':'Enable reminders separately on each Android phone.');
  }catch(error){if(stamp===epoch&&active)note(error.message,true);}finally{if(stamp===epoch){busy=false;render();}}
 }
 function publicKey(value){const decoded=atob(value.replaceAll('-','+').replaceAll('_','/'));return Uint8Array.from(decoded,c=>c.charCodeAt(0));}
 async function enableGranted(stamp){
  if(stamp!==epoch||!active)return;
  if(subscription&&!current()){await subscription.unsubscribe();subscription=null;}
  if(stamp!==epoch||!active||!status?.publicKey)return;
  subscription=subscription||await registration.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:publicKey(status.publicKey)});
  if(stamp!==epoch||!active)return;
  const result=await call({action:'subscribe',subscription:subscription.toJSON(),origin:location.origin,timezone:Intl.DateTimeFormat().resolvedOptions().timeZone});
  if(stamp!==epoch||!active)return;status=result;note('Booking alerts and reminders enabled. Send a test notification to check this phone.');intent=false;
 }
 el('enablePush').onclick=async()=>{
  if(busy||!active||!status?.publicKey)return;const stamp=epoch;busy=true;intent=true;note('Waiting for notification permission…');render();
  try{const permission=await Notification.requestPermission();if(permission!=='granted'){note(permission==='denied'?'Allow notifications in Chrome’s site settings, then return here.':'Permission was not granted. Tap Enable on this phone to try again.');return;}await enableGranted(stamp);}catch(error){if(stamp===epoch)note(error.message||'Unable to enable reminders. Please retry.',true);}finally{if(stamp===epoch){busy=false;render();}}
 };
 async function disable(device){
  if(busy||!active)return;const stamp=epoch;busy=true;render();
  try{await call({action:'disable',deviceId:device.id});if(stamp!==epoch)return;if(device.current&&subscription){await subscription.unsubscribe();subscription=null;}status.devices=status.devices.filter(row=>row.id!==device.id);note('Reminders disabled for '+device.label+'.');}catch(error){if(stamp===epoch)note(error.message,true);}finally{if(stamp===epoch){busy=false;render();}}
 }
 el('disablePush').onclick=()=>{if(current())disable(current());};
 el('testPush').onclick=async()=>{
  if(busy||!active||!current())return;const stamp=epoch;busy=true;note('Sending a test notification…');render();
  try{await call({action:'test',deviceId:current().id,endpoint:subscription.endpoint});if(stamp===epoch)note('Test notification sent. Check this phone’s notifications.');}catch(error){if(stamp===epoch)note(error.message,true);}finally{if(stamp===epoch){busy=false;render();}}
 };
 el('refreshPush').onclick=()=>refresh(true);
 window.addEventListener('admin-ready',()=>{if(!active){active=true;epoch++;}refresh();});
 window.addEventListener('admin-logged-out',()=>{active=false;busy=false;epoch++;status=null;intent=false;el('pushDevices').replaceChildren();note('');el('pushState').textContent='Not enabled';});
 if(supported&&navigator.permissions){navigator.permissions.query({name:'notifications'}).then(watch=>{permissionWatch=watch;watch.onchange=async()=>{if(!active)return;if(watch.state==='granted'&&intent&&!busy&&status?.publicKey){const stamp=epoch;busy=true;try{await enableGranted(stamp);}catch(error){note(error.message,true);}finally{if(stamp===epoch){busy=false;render();}}}else if(!busy)refresh(true);};}).catch(()=>{});}
 setInterval(()=>{if(active&&!busy)refresh();},60000);
 if(!el('app').classList.contains('hidden')){active=true;epoch++;refresh();}
})();
