'use strict';
// Follow the device unless the visitor explicitly chooses a fixed appearance.
(()=>{
 const root=document.documentElement,key='interviewBookingTheme',device=matchMedia('(prefers-color-scheme: dark)');
 const valid=value=>['system','light','dark'].includes(value);
 let preference='system',updateControl=()=>{};
 try{const saved=localStorage.getItem(key);if(valid(saved))preference=saved;}catch{}
 function apply(){
  const theme=preference==='system'?(device.matches?'dark':'light'):preference;
  root.dataset.theme=theme;root.dataset.themePreference=preference;root.style.colorScheme='only '+theme;
  const scheme=document.querySelector('meta[name="color-scheme"]');
  if(scheme)scheme.content=theme==='dark'?'dark':'only light';
  const color=document.querySelector('meta[name="theme-color"]');
  if(color){color.removeAttribute('media');color.content=theme==='dark'?'#0c111e':'#f5f6fb';}
  updateControl();
 }
 apply();
 device.addEventListener('change',()=>{if(preference==='system')apply();});
 window.addEventListener('storage',event=>{if(event.key===key||event.key===null){preference=valid(event.newValue)?event.newValue:'system';apply();}});
 document.addEventListener('DOMContentLoaded',()=>{
  const header=document.querySelector('.topbar,.member-topbar');if(!header)return;
  const actions=document.createElement('div');actions.className='header-actions';
  const existing=header.querySelector('.manage-link,#logout,.member-back-link');
  if(existing)actions.append(existing);
  const select=document.createElement('select');select.id='themeSelect';select.className='quiet theme-select';select.setAttribute('aria-label','Appearance');
  select.innerHTML='<option value="system">Device theme</option><option value="light">Light mode</option><option value="dark">Dark mode</option>';
  updateControl=()=>{select.value=preference;};
  select.onchange=()=>{preference=select.value;try{localStorage.setItem(key,preference);}catch{}apply();};
  updateControl();actions.append(select);header.append(actions);
 });
})();
