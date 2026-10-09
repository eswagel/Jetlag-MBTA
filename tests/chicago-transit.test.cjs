const test=require('node:test');const assert=require('node:assert/strict');
const data=require('../data/chicago/transit.json');const calendar=require('../data/chicago/service-calendar.json');
const {snapshot,validateSnapshot}=require('../assets/js/app/chicago-service.js');
const line=id=>data.lines.find(l=>l.id===id);const ids=id=>new Set(line(id).stops.map(s=>s.id));
test('official CTA parent IDs preserve full rail network and reference agencies',()=>{
  assert.equal(new Set(data.lines.flatMap(l=>l.stops.map(s=>s.id))).size,143);
  assert.equal(data.commuterRail.filter(s=>s.agency==='Metra').length,239);
  assert.equal(data.commuterRail.filter(s=>s.agency==='South Shore').length,21);
  assert(ids('Blue').has('40890')); // O'Hare, outside Chicago core
  assert(ids('Purple').has('41050')); // Linden, Wilmette
  for(const l of data.lines){assert(l.shapePath.length>2);assert.equal(ids(l.id).size,l.stops.length);}
  const repeated=data.lines.flatMap(l=>l.stops).filter(s=>s.name.startsWith('Western'));
  assert(new Set(repeated.map(s=>s.id)).size>1,'same-name stations must not be collapsed');
});
test('Green southern branches exclude each other while sharing the trunk',()=>{
  assert(ids('Green-Ashland').has('40290'));assert(ids('Green-Ashland').has('40940'));
  assert(!ids('Green-Ashland').has('40720'));
  assert(ids('Green-Cottage').has('40720'));assert(!ids('Green-Cottage').has('40290'));assert(!ids('Green-Cottage').has('40940'));
  assert(ids('Green-Ashland').has('40020')&&ids('Green-Cottage').has('40020')); // Harlem/Lake
});
test('current weekday rush hour differs from midday and weekend; coverage expires',()=>{
  const morning=snapshot(calendar,'Purple-Express','2026-10-07T13:00:00Z');
  assert.equal(morning.status,'scheduled-active');assert(morning.stationIds.includes('41050'));
  assert(!morning.stationIds.includes('41300'),'Loyola is bypassed');
  assert.equal(snapshot(calendar,'Purple-Express','2026-10-07T17:00:00Z').status,'scheduled-inactive');
  assert.equal(snapshot(calendar,'Purple-Express','2026-10-10T13:00:00Z').status,'scheduled-inactive');
  assert.equal(snapshot(calendar,'Purple-Express','2027-01-01T13:00:00Z').status,'unknown');
  assert.equal(snapshot(calendar,'Purple-Express','2026-09-01T13:00:00Z').status,'unknown');
});
function fixture(overrides={}){return {feedVersion:'test',coverage:{start:'20260101',end:'20261231'},calendar:[{service_id:'s',start_date:'20260101',end_date:'20261231',sunday:'1',monday:'1',tuesday:'1',wednesday:'1',thursday:'1',friday:'1',saturday:'1'}],exceptions:[],patterns:[{lineId:'Purple-Express',stationIds:['a']}],trips:[{id:'t',serviceId:'s',pattern:0,start:7*3600,end:9*3600}],...overrides};}
test('calendar removals and additions override ordinary weekday service',()=>{
  let f=fixture({exceptions:[{service_id:'s',date:'20260704',exception_type:'2'}]});
  assert.equal(snapshot(f,'Purple-Express','2026-07-04T13:00:00Z').status,'scheduled-inactive');
  f.calendar=[];f.exceptions[0].exception_type='1';
  assert.equal(snapshot(f,'Purple-Express','2026-07-04T13:00:00Z').status,'scheduled-active');
});
test('Chicago DST and after-midnight GTFS service use service-day semantics',()=>{
  const f=fixture();
  assert.equal(snapshot(f,'Purple-Express','2026-03-08T13:00:00Z').status,'scheduled-active'); // 08 CDT
  assert.equal(snapshot(f,'Purple-Express','2026-11-01T14:00:00Z').status,'scheduled-active'); // 08 CST
  f.trips[0].start=25*3600;f.trips[0].end=26*3600;f.exceptions=[{service_id:'s',date:'20261007',exception_type:'2'}];
  assert.equal(snapshot(f,'Purple-Express','2026-10-07T06:30:00Z').status,'scheduled-active'); // previous day's 25:30
  assert.equal(snapshot(f,'Purple-Express','2026-10-08T06:30:00Z').status,'scheduled-inactive');
});
test('snapshots validate timestamps, station membership and source semantics',()=>{
  const value=snapshot(fixture(),'Purple-Express','2026-10-07T13:00:00Z');
  const rules={lineId:'Purple-Express',stationIds:['a'],observedAt:'2026-10-07T13:01:00Z'};
  assert(validateSnapshot(value,rules));assert(!validateSnapshot({...value,stationIds:['forged']},rules));
  assert(!validateSnapshot({...value,observedAt:'2026-10-07T13:02:00Z'},rules));
  assert(!validateSnapshot({...value,status:'live-active'},rules));
  assert(!validateSnapshot(value,{...rules,observedAt:'2026-10-07T13:03:00Z'}));
  assert.equal(snapshot(null,'Purple-Express').status,'unknown');
});
