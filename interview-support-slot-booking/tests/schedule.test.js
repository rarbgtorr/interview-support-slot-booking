'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const S=require('../public/schedule');
test('40 half-hour slots from 7 AM to 3 AM, partitioned without gaps',()=>{
  assert.equal(S.STARTS.length,40);assert.equal(S.STARTS[0],420);assert.equal(S.STARTS.at(-1),1590);
  assert.deepEqual(S.GROUPS.map(g=>S.STARTS.filter(m=>m>=g.from&&m<g.to).length),[10,10,8,12]);
  assert.equal(S.STARTS.filter(m=>S.GROUPS.filter(g=>m>=g.from&&m<g.to).length!==1).length,0);
});
test('after midnight belongs to the next actual date, including year rollover',()=>{
  assert.equal(S.instant('2030-12-31',1440).toISOString(),'2030-12-31T18:30:00.000Z');
  assert.equal(S.dateKey(S.instant('2030-12-31',1440)),'2031-01-01');
  assert.equal(S.dateKey(S.instant('2030-12-31',1530)),'2031-01-01');
});
test('previous service date remains selectable before 3 AM IST',()=>{
  assert.equal(S.currentServiceDate(new Date('2031-01-01T01:00:00+05:30')),'2030-12-31');
  assert.equal(S.currentServiceDate(new Date('2031-01-01T03:00:00+05:30')),'2031-01-01');
});
test('60-minute booking crosses groups and midnight, but cannot overrun closing',()=>{
  for(const minute of [690,990,1230,1410,1560])assert.equal(S.validSelection('2030-01-01',minute,60,0),true);
  assert.equal(S.validSelection('2030-01-01',1590,60,0),false);
  assert.equal(S.validSelection('2030-01-01',1590,30,0),true);
});
test('either unavailable half disables a 60-minute booking',()=>{
  assert.equal(S.state({630:'booked'},600,60,'2030-01-01',0),'booked');
  assert.equal(S.state({630:'blocked'},600,60,'2030-01-01',0),'blocked');
  assert.equal(S.state({630:'booked'},600,30,'2030-01-01',0),'available');
});
test('no past slots, malformed dates, unsupported durations or off-grid starts',()=>{
  assert.equal(S.validSelection('2030-02-30',420,30,0),false);
  assert.equal(S.validSelection('2030-02-01',425,30,0),false);
  assert.equal(S.validSelection('2030-02-01',420,90,0),false);
  assert.equal(S.validSelection('2030-02-01',420,30,S.instant('2030-02-01',420).getTime()),false);
  assert.equal(S.validZone('Not/AZone'),false);assert.equal(S.validZone(''),false);
});
test('selected timezone uses the correct local date and daylight-saving offset',()=>{
  const summer=S.instant('2030-07-01',420),winter=S.instant('2030-01-01',420);
  assert.equal(S.dateKey(summer,'America/New_York'),'2030-06-30');
  assert.match(S.clock(summer,'America/New_York'),/9:30/i);
  assert.match(S.clock(winter,'America/New_York'),/8:30/i);
  assert.match(S.localLabel('2030-01-01',1410,60),/1 Jan 2030.*2 Jan 2030/);
});
