const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const t=require('@turf/turf');
function context(city){const turf={...t,union:(a,b)=>t.union(t.featureCollection([a,b])),intersect:(a,b)=>t.intersect(t.featureCollection([a,b])),difference:(a,b)=>t.difference(t.featureCollection([a,b]))};const c=vm.createContext({console,turf,URLSearchParams,window:{location:{search:'?city='+city}},localStorage:{getItem:()=>null},document:{getElementById:()=>null},navigator:{}});for(const f of ['00-cities.js','01-core.js','03-setup.js'])vm.runInContext(fs.readFileSync('assets/js/app/'+f,'utf8'),c);return {c,run:s=>vm.runInContext(s,c)};}
for(const city of ['boston','chicago']){
 test(city+': contradictory hard radar answers produce and retain zero area',()=>{
  const {run}=context(city);run(`var center={lat:42,lng:-71};var zone=makeCircle(center,.25,'miles');var q={type:'radar',center,radius_miles:25,answer:'no'};var empty=QDEFS.radar.applyToZone(zone,q);`);
  assert.equal(run('turf.area(empty)'),0);
  assert.equal(run("turf.area(QDEFS.radar.applyToZone(empty,{...q,answer:'yes'}))"),0);
  assert.equal(run('turf.area(deriveZoneStateFromConstraints(zone,[q]).validZone)'),0);
  assert.equal(run('turf.area(buildRedMaskFeature(zone,empty))'),run('turf.area(zone)'));
 });
 test(city+': soft matching makes completely excluded catchments yellow, retains expected hider',()=>{
  const {run,c}=context(city);run(`var bases=[{id:'inside',stop:{},baseRegion:turf.bboxPolygon([0,0,1,1])},{id:'outside',stop:{},baseRegion:turf.bboxPolygon([3,0,4,1])}];buildStopBaseRegionEntries=()=>bases;var boundary=turf.bboxPolygon([-.1,-.1,1.1,1.1]);var q={type:'matching',category:'city',answer:'Yes',boundary_geojson:boundary,constraint_effect:'soft'};var state=deriveStopRegionState(turf.bboxPolygon([0,0,4,1]),[q]);`);
  assert.equal(run('state.byStop.inside.status'),'in-play');assert.equal(run('state.byStop.inside.hasGreen'),true);
  assert.equal(run('state.byStop.outside.status'),'temporary');assert.equal(run('state.byStop.outside.hasGreen'),false);assert.equal(run('state.byStop.outside.hasYellow'),true);
  assert.equal(run('state.byStop.outside.inPlay'),true,'soft clues do not permanently remove the station');
 });
 test(city+': empty matching, nearest and boundary answers never restore the old zone',()=>{
  const {run}=context(city);run("var z=turf.bboxPolygon([0,0,1,1]);var outside=turf.bboxPolygon([2,2,3,3]);");
  for(const expression of ["QDEFS.matching.applyToZone(z,{answer:'Yes',boundary_geojson:outside})","QDEFS.matching.applyToZone(z,{answer:'No',boundary_geojson:z})","QDEFS.nearest.applyToZone(z,{answer:'Yes',voronoi_geojson:outside})","QDEFS.custom_boundary.applyToZone(z,{mode:'exclude',boundary_geojson:z})"]){assert.equal(t.area(run(expression)),0);}
 });
 test(city+': tentacle selections outside surviving scope yield empty without confusing missing options',()=>{
  const {run}=context(city);run(`var q={type:'tentacles',center:{lat:0,lng:0},radius_miles:1,options:[{id:'a',name:'A',lat:0,lng:0},{id:'b',name:'B',lat:0,lng:.005}],answer:'a'};var z=turf.bboxPolygon([2,2,3,3]);`);
  assert.equal(run('turf.area(QDEFS.tentacles.applyToZone(z,q))'),0);
  assert.equal(run("turf.area(QDEFS.tentacles.applyToZone(z,{...q,answer:'unknown'}))"),run('turf.area(z)'));
 });
}
test('overlay errors are not evidence of an empty region',()=>{
 const {run}=context('boston');run("var z=turf.bboxPolygon([0,0,1,1]);var broken={type:'Feature',properties:{},geometry:{type:'Point',coordinates:[0,0]}};");
 assert.equal(run('safeIsect(z,broken)'),run('z'));assert.equal(run('safeDiff(z,broken)'),run('z'));assert.equal(run('safeIsect(z,null)'),run('z'));
 assert.throws(()=>run('exactIsect(z,broken)'));assert.throws(()=>run('exactDiff(z,broken)'));
});
test('valid tiny residuals are retained instead of reverting matching area',()=>{
 const {run}=context('boston');run('var z=turf.bboxPolygon([0,0,1,1]);var tiny=turf.bboxPolygon([0,0,.0001,.0001]);');
 const area=run("turf.area(QDEFS.matching.applyToZone(z,{answer:'Yes',boundary_geojson:tiny}))");assert.ok(area>0&&area<1000);
});
test('Boston legacy elevation has explicit empty region above every sampled height',()=>{
 const {run}=context('boston');run('preloadedData.elevation={latitudes:[0,1],longitudes:[0,1],values:[[10,10],[10,10]]};');
 assert.equal(run('turf.area(buildElevationConstraintFeature({seeker_elevation_ft:11}))'),0);
});
