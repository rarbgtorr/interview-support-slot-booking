(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Schedule = api;
})(typeof globalThis === 'object' ? globalThis : this, function () {
  'use strict';
  const TIMEZONE = 'Asia/Kolkata';
  const START = 420, END = 1620, STEP = 30;
  const GROUPS = [
    {id:'morning', label:'Morning', from:420, to:720},
    {id:'afternoon', label:'Afternoon', from:720, to:1020},
    {id:'evening', label:'Evening', from:1020, to:1260},
    {id:'night', label:'Night', from:1260, to:1620}
  ];
  const STARTS = Array.from({length:(END-START)/STEP}, (_,i)=>START+i*STEP);
  function validDate(date) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) return false;
    const d = new Date(date+'T00:00:00Z');
    return Number.isFinite(d.getTime()) && d.toISOString().slice(0,10) === date;
  }
  function validZone(zone) {
    if (typeof zone !== 'string' || !zone) return false;
    try { new Intl.DateTimeFormat('en-US',{timeZone:zone}); return true; } catch { return false; }
  }
  function normalizeZone(zone) {
    return {'Asia/Calcutta':'Asia/Kolkata','Asia/Katmandu':'Asia/Kathmandu','Europe/Kiev':'Europe/Kyiv','America/Godthab':'America/Nuuk'}[zone] || zone;
  }
  function dateKey(value, zone=TIMEZONE) {
    const parts = new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(value));
    const get = type => parts.find(p=>p.type===type).value;
    return `${get('year')}-${get('month')}-${get('day')}`;
  }
  function addDays(date, days) {
    return new Date(new Date(date+'T00:00:00Z').getTime()+days*86400000).toISOString().slice(0,10);
  }
  function currentServiceDate(now=new Date()) {
    const today = dateKey(now);
    // The previous operating day still has late-night slots before 3 AM IST.
    return new Date(now).getTime() < instant(today,180).getTime() ? addDays(today,-1) : today;
  }
  function instant(date, minute) {
    return new Date(new Date(date+'T00:00:00+05:30').getTime()+minute*60000);
  }
  function clock(value, zone=TIMEZONE) {
    return new Intl.DateTimeFormat('en-IN',{timeZone:zone,hour:'numeric',minute:'2-digit',hour12:true}).format(new Date(value));
  }
  function dateLabel(date) {
    return new Intl.DateTimeFormat('en-IN',{timeZone:'UTC',weekday:'long',day:'numeric',month:'long',year:'numeric'}).format(new Date(date+'T12:00:00Z'));
  }
  function localLabel(date, minute, duration, zone=TIMEZONE) {
    const a=instant(date,minute), b=new Date(a.getTime()+duration*60000);
    const short=d=>new Intl.DateTimeFormat('en-IN',{timeZone:zone,day:'numeric',month:'short',year:'numeric'}).format(d);
    if(dateKey(a,zone)===dateKey(b,zone))return `${short(a)} · ${clock(a,zone)} – ${clock(b,zone)}`;
    return `${short(a)} · ${clock(a,zone)} – ${short(b)} · ${clock(b,zone)}`;
  }
  function validSelection(date, minute, duration, now=Date.now()) {
    return validDate(date) && STARTS.includes(minute) && duration===30 && minute+duration<=END && instant(date,minute).getTime()>Number(now);
  }
  const zoneHourFormatters = new Map();
  function groupInZone(date, minute, zone=TIMEZONE) {
    let formatter=zoneHourFormatters.get(zone);
    if(!formatter){formatter=new Intl.DateTimeFormat('en-GB',{timeZone:zone,hour:'numeric',hourCycle:'h23'});zoneHourFormatters.set(zone,formatter);}
    const hour=Number(formatter.formatToParts(instant(date,minute)).find(p=>p.type==='hour').value)%24;
    const id=hour>=6&&hour<12?'morning':hour>=12&&hour<17?'afternoon':hour>=17&&hour<21?'evening':'night';
    return GROUPS.find(g=>g.id===id);
  }
  function groupFor(minute) { return GROUPS.find(g=>minute>=g.from&&minute<g.to); }
  return {TIMEZONE,START,END,STEP,GROUPS,STARTS,validDate,validZone,normalizeZone,dateKey,addDays,currentServiceDate,instant,clock,dateLabel,localLabel,validSelection,groupFor,groupInZone};
});
