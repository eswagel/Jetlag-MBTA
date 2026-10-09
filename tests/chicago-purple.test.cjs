const test=require('node:test'),assert=require('node:assert/strict');
const service=require('../assets/js/app/chicago-service.js');
const data=require('../data/chicago/service-calendar.json');
const morning='2026-10-07T13:00:00Z',noon='2026-10-07T17:00:00Z';
const makeFeed=(entities,at=morning)=>({header:{timestamp:Date.parse(at)/1000},entity:entities.map(trip_update=>({trip_update}))});
test('single Purple identity includes Loop only during scheduled express service',()=>{
  const rush=service.snapshot(data,'Purple',morning),midday=service.snapshot(data,'Purple',noon);
  assert.equal(rush.status,'scheduled-active');assert.equal(midday.status,'scheduled-active');
  assert(rush.stationIds.includes('41700'));assert(!midday.stationIds.includes('41700'));
  assert(midday.stationIds.includes('41050'));assert(midday.stationIds.includes('40900'));
  assert.deepEqual(service.replay(data,rush),rush);
});
test('live Purple special stopping pattern may add Addison without adding every nearby station',()=>{
  const id=service.snapshot(data,'Purple',morning).tripIds[0];
  const feed=makeFeed([{trip:{trip_id:id,route_id:'P'},stop_time_update:[{stop_id:'41420',arrival:{time:Date.parse(morning)/1000+300}}]}]);
  const result=service.withRealtime(data,feed,morning);
  assert.equal(result.source,'cta-gtfs-realtime+schedule');assert(result.stationIds.includes('41420'));
  assert(!result.stationIds.includes('41300')); // Loyola remains bypassed
  assert.deepEqual(service.replay(data,result),result);
  assert.equal(service.replay({...data,feedVersion:'changed'},result),null);
});
test('missing, stale and foreign-route predictions retain explicit schedule fallback',()=>{
  const noData=service.withRealtime(data,makeFeed([]),morning);
  assert.equal(noData.source,'cta-gtfs-schedule');assert.equal(noData.fallbackReason,'no-current-purple-live-evidence');
  const stale=service.withRealtime(data,makeFeed([],noon),morning);
  assert.equal(stale.fallbackReason,'live-feed-stale-or-invalid');
  const other=service.withRealtime(data,makeFeed([{trip:{route_id:'Red',trip_id:'external'},stop_time_update:[{stop_id:'41420',arrival:{time:Date.parse(morning)/1000+30}}]}]),morning);
  assert(!other.stationIds.includes('41420'));
});
test('live cancellations and skipped special stops do not invent station membership',()=>{
  const ids=service.snapshot(data,'Purple',morning).tripIds;
  const canceled=service.withRealtime(data,makeFeed(ids.map(id=>({trip:{trip_id:id,route_id:'P',schedule_relationship:'CANCELED'}}))),morning);
  assert.equal(canceled.status,'live-assisted-inactive');assert.equal(canceled.stationIds.length,0);
  const skipped=service.withRealtime(data,makeFeed([{trip:{trip_id:ids[0],route_id:'P'},stop_time_update:[{stop_id:'41420',schedule_relationship:'SKIPPED',arrival:{time:Date.parse(morning)/1000+30}}]}]),morning);
  assert(!skipped.stationIds.includes('41420'));
});

test('sequence-only GTFS-RT updates map actual GTFS sequence values to parent stations',()=>{
  const current=service.snapshot(data,'Purple',morning);
  const trip=data.trips.find(t=>t.id===current.tripIds[0]);
  const [sequence,parent]=Object.entries(trip.stopSequenceParents)[1];
  const isolated={...data,trips:[trip]};
  assert(service.snapshot(isolated,'Purple',morning).stationIds.includes(parent));
  const skipped=service.withRealtime(isolated,makeFeed([{trip:{trip_id:trip.id,route_id:'P'},stop_time_update:[{stop_sequence:Number(sequence),schedule_relationship:'SKIPPED'}]}]),morning);
  assert(!skipped.stationIds.includes(parent),'sequence-only SKIPPED must remove the correctly mapped station');
  assert.equal(skipped.liveEvidence.evidence[0].skippedStationIds[0],parent);
  // The same known trip is running outside its published time: a timed live update
  // identifies the actual next station by sequence, even without a stop_id.
  const delayed={...isolated,trips:[{...trip,start:0,end:1}]};
  assert.equal(service.snapshot(delayed,'Purple',morning).stationIds.length,0);
  const added=service.withRealtime(delayed,makeFeed([{trip:{trip_id:trip.id,route_id:'P'},stop_time_update:[{stop_sequence:Number(sequence),arrival:{time:Date.parse(morning)/1000+60}}]}]),morning);
  assert.deepEqual(added.stationIds,[parent]);
  assert.deepEqual(service.replay(delayed,added),added);
  const unknown=service.withRealtime(delayed,makeFeed([{trip:{trip_id:trip.id,route_id:'P'},stop_time_update:[{stop_sequence:999999,arrival:{time:Date.parse(morning)/1000+60}}]}]),morning);
  assert.equal(unknown.source,'cta-gtfs-schedule');
});
