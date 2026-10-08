const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const t = require('@turf/turf');
const turf = {...t,
  union:(a,b)=>t.union(t.featureCollection([a,b])),
  intersect:(a,b)=>t.intersect(t.featureCollection([a,b])),
  difference:(a,b)=>t.difference(t.featureCollection([a,b])),
};
function game(city){
  const context=vm.createContext({console,turf,URLSearchParams,URL,setTimeout,clearTimeout,
    window:{location:{search:'?city='+city}},localStorage:{getItem:()=>null},
    document:{getElementById:()=>null},navigator:{}});
  for(const file of ['00-cities.js','linear-distance-filter.js','01-core.js','02-map.js','03-setup.js','04-build.js','05-hider.js','06-seeker.js','04-city-questions.js']){
    vm.runInContext(fs.readFileSync('assets/js/app/'+file,'utf8'),context,{filename:file});
  }
  const run=code=>vm.runInContext(code,context);
  run(`var origin=${JSON.stringify(city==='chicago'?{lat:41.88,lng:-87.63}:{lat:42.36,lng:-71.06})};
    var base=turf.bboxPolygon([origin.lng-.006,origin.lat-.006,origin.lng+.006,origin.lat+.006]);
    var left=turf.bboxPolygon([origin.lng-.006,origin.lat-.006,origin.lng,origin.lat+.006]);
    var right=turf.bboxPolygon([origin.lng,origin.lat-.006,origin.lng+.006,origin.lat+.006]);
    var entries=[{id:'one',stop:{id:'one',...origin,lines:['Red']},baseRegion:base}];
    buildStopBaseRegionEntries=()=>entries;
    var clues={
      radar:[{type:'radar',center:origin,radius_miles:.2,answer:'yes'},{type:'radar',center:origin,radius_miles:.2,answer:'no'}],
      thermo:[{type:'thermo',center:{lat:origin.lat,lng:origin.lng-.003},thermo_dest:{lat:origin.lat,lng:origin.lng+.003},travel_miles:.3,answer:'closer'},{type:'thermo',center:{lat:origin.lat,lng:origin.lng-.003},thermo_dest:{lat:origin.lat,lng:origin.lng+.003},travel_miles:.3,answer:'further'}],
      matching:[{type:'matching',category:'city',boundary_geojson:left,answer:'Yes',constraint_effect:'soft'},{type:'matching',category:'city',boundary_geojson:right,answer:'Yes',constraint_effect:'soft'}],
      measure:[{type:'measure',all_instances:[origin],seeker_dist:.2,answer:'closer'},{type:'measure',all_instances:[origin],seeker_dist:.2,answer:'further'}],
      tentacles:[{type:'tentacles',center:origin,radius_miles:1,options:[{id:'west',name:'West',lat:origin.lat,lng:origin.lng-.003},{id:'east',name:'East',lat:origin.lat,lng:origin.lng+.003}],answer:'west'},{type:'tentacles',center:origin,radius_miles:1,options:[{id:'west',name:'West',lat:origin.lat,lng:origin.lng-.003},{id:'east',name:'East',lat:origin.lat,lng:origin.lng+.003}],answer:'east'}]
    };`);
  return {run,context};
}
function sameArea(actual,expected,message){
  assert.ok(actual&&expected,message+' has geometry');
  assert.ok(Math.abs(t.area(actual)-t.area(expected))<.01,message);
  const extra=turf.difference(actual,expected),missing=turf.difference(expected,actual);
  assert.ok((extra?t.area(extra):0)+(missing?t.area(missing):0)<.01,message+' matches geometry, not just area');
}
for(const city of ['boston','chicago']){
  for(const kind of ['radar','thermo','matching','measure','tentacles']){
    test(`${city}: ${kind} disjoint observations retain the station with the latest temporary split`,()=>{
      const {run}=game(city);
      const expected=run(`QDEFS[clues.${kind}[1].type].applyToZone(base,clues.${kind}[1])`);
      assert.ok(t.area(expected)>0&&t.area(expected)<t.area(run('base')),'fixture genuinely splits the catchment');
      const previous=run(`QDEFS[clues.${kind}[0].type].applyToZone(base,clues.${kind}[0])`);
      const overlap=turf.intersect(previous,expected);
      assert.ok(!overlap||t.area(overlap)<.01,'observations occupy disjoint parts of one catchment');
      const state=run(`deriveZoneStateFromConstraints(base,clues.${kind})`);
      assert.equal(state.stopState.byStop.one.status,'temporary');
      sameArea(state.validZone,run('base'),'station retains its whole hiding area');
      sameArea(state.stopState.byStop.one.greenRegion,expected,'current clue determines green area');
      sameArea(state.stopState.byStop.one.yellowRegion,turf.difference(run('base'),expected),'remaining area is temporary');
    });
  }
  test(`${city}: mixed matching and radar observations allow movement across the same catchment`,()=>{
    const {run}=game(city);
    const result=run(`var matching={...clues.matching[0],boundary_geojson:turf.bboxPolygon([origin.lng-.006,origin.lat-.006,origin.lng-.004,origin.lat+.006])};
      var radar=clues.radar[0];deriveZoneStateFromConstraints(base,[matching,radar])`);
    assert.equal(result.stopState.byStop.one.status,'temporary');
    sameArea(result.validZone,run('base'),'mixed question families preserve eligible catchment');
    sameArea(result.stopState.byStop.one.greenRegion,run('QDEFS.radar.applyToZone(base,radar)'),'radar supplies latest split');
  });
  test(`${city}: a single wholly incompatible observation permanently excludes a station`,()=>{
    const {run}=game(city);
    const result=run(`deriveZoneStateFromConstraints(base,[{type:'radar',center:origin,radius_miles:5,answer:'no'},clues.matching[0]])`);
    assert.equal(result.stopState.byStop.one.status,'eliminated');
    assert.equal(t.area(result.validZone),0,'later compatible observations cannot resurrect eliminated station');
  });
  test(`${city}: a manual boundary remains a fixed exclusion when later observations require it`,()=>{
    const {run}=game(city);
    const result=run(`deriveZoneStateFromConstraints(base,[{type:'custom_boundary',mode:'include',boundary_geojson:left},{...clues.matching[1],boundary_geojson:turf.bboxPolygon([origin.lng+.001,origin.lat-.006,origin.lng+.006,origin.lat+.006])}])`);
    assert.equal(result.stopState.byStop.one.status,'eliminated');
    assert.equal(t.area(result.validZone),0);
  });
  for(const answer of ['Yes','No']){
    test(`${city}: line matching ${answer} filters station identity rather than overlapping catchments`,()=>{
      const {run}=game(city);
      run(`var second=turf.bboxPolygon([origin.lng,origin.lat-.006,origin.lng+.012,origin.lat+.006]);
        entries.push({id:'two',stop:{id:'two',lat:origin.lat,lng:origin.lng+.006,lines:['Blue']},baseRegion:second});
        preloadedData.mbta={feedVersion:'fixture-feed',lines:[{id:'Red',stops:[{id:'one',...origin}]},{id:'Blue',stops:[{id:'two',lat:origin.lat,lng:origin.lng+.006}]}]};
        var question={type:'matching',category:'line',line_id:'Red',answer:${JSON.stringify(answer)},boundary_geojson:base,
          service_snapshot:{lineId:'Red',stationIds:['one'],status:'static',observedAt:'2026-10-07T12:00:00Z',datasetVersion:ACTIVE_CITY.datasetVersion,feedVersion:'fixture-feed'}};
        var initial=turf.union(base,second);`);
      const state=run('deriveZoneStateFromConstraints(initial,[question])');
      const alive=answer==='Yes'?'one':'two',dead=answer==='Yes'?'two':'one';
      assert.equal(state.stopState.byStop[alive].status,'in-play');
      assert.equal(state.stopState.byStop[dead].status,'eliminated');
      sameArea(state.validZone,run(answer==='Yes'?'base':'second'),'kept station retains full catchment including overlap');
    });
  }
}
