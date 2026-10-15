'use strict';
self.addEventListener('push',event=>{
 let data={};try{data=event.data?.json()||{};}catch{}
 const late=data.startsAt&&Date.parse(data.startsAt)<=Date.now();
 const title=late?'Appointment reminder':String(data.title||'Interview Slot Booking').slice(0,100);
 const body=String(data.body||'Open the administrator page to view your appointments.').slice(0,500);
 let url='/admin';try{const link=new URL(data.url||url,self.location.origin);if(link.origin===self.location.origin&&link.pathname==='/admin')url=link.pathname+link.search;}catch{}
 event.waitUntil(self.registration.showNotification(title,{body:late?'This appointment may have started. '+body:body,tag:String(data.tag||'admin-reminder').slice(0,200),renotify:false,data:{url},vibrate:[120,80,120]}));
});
self.addEventListener('notificationclick',event=>{
 event.notification.close();const url=new URL(event.notification.data?.url||'/admin',self.location.origin).href;
 event.waitUntil((async()=>{const windows=await self.clients.matchAll({type:'window',includeUncontrolled:true});const existing=windows.find(client=>new URL(client.url).origin===self.location.origin&&new URL(client.url).pathname.startsWith('/admin'));if(existing){await existing.navigate(url);await existing.focus();}else await self.clients.openWindow(url);})());
});
self.addEventListener('activate',event=>event.waitUntil(self.clients.claim()));
self.addEventListener('install',event=>event.waitUntil(self.skipWaiting()));
