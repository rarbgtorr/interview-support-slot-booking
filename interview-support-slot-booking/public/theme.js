'use strict';
// Match the device automatically, with no appearance controls or saved overrides.
(()=>{
 const root=document.documentElement,device=matchMedia('(prefers-color-scheme: dark)');
 function apply(){
  const theme=device.matches?'dark':'light';
  root.dataset.theme=theme;root.style.colorScheme='only '+theme;
  const scheme=document.querySelector('meta[name="color-scheme"]');
  if(scheme)scheme.content=theme==='dark'?'dark':'only light';
  const color=document.querySelector('meta[name="theme-color"]');
  if(color){color.removeAttribute('media');color.content=theme==='dark'?'#0c111e':'#f5f6fb';}
 }
 apply();device.addEventListener('change',apply);
})();
