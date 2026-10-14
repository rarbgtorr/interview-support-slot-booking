'use strict';
// Apply the saved choice before styles load; normal appearance defaults to light.
(()=>{
 const root=document.documentElement,key='interviewBookingTheme';
 let theme='light';
 try{if(localStorage.getItem(key)==='dark')theme='dark';}catch{}
 function apply(value){
  theme=value;root.dataset.theme=theme;root.style.colorScheme='only '+theme;
  const scheme=document.querySelector('meta[name="color-scheme"]');
  if(scheme)scheme.content='only '+theme;
  const color=document.querySelector('meta[name="theme-color"]');
  if(color){color.removeAttribute('media');color.content=theme==='dark'?'#0c111e':'#f5f6fb';}
 }
 apply(theme);
 document.addEventListener('DOMContentLoaded',()=>{
  const header=document.querySelector('.topbar,.member-topbar');if(!header)return;
  const actions=document.createElement('div');actions.className='header-actions';
  const existing=header.querySelector('.manage-link,#logout,.member-back-link');
  if(existing)actions.append(existing);
  const toggle=document.createElement('button');toggle.type='button';toggle.className='quiet theme-toggle';
  function label(){
   const dark=theme==='dark';
   toggle.setAttribute('aria-label','Switch to '+(dark?'light':'dark')+' mode');
   toggle.setAttribute('aria-pressed',String(dark));
   toggle.innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'+(dark?'<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.4 1.4m11.2 11.2L19 19M5 19l1.4-1.4M17.6 6.4L19 5"/>':'<path d="M20.9 13A9 9 0 0 1 11 3.1 9 9 0 1 0 20.9 13Z"/>')+'</svg><span>'+(dark?'Light mode':'Dark mode')+'</span>';
  }
  toggle.onclick=()=>{apply(theme==='dark'?'light':'dark');try{localStorage.setItem(key,theme);}catch{}label();};
  label();actions.append(toggle);header.append(actions);
 });
})();
