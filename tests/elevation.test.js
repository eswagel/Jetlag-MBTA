const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const t=require('@turf/turf');
const turf={...t,intersect:(a,b)=>t.intersect(t.featureCollection([a,b])),difference:(a,b)=>t.difference(t.featureCollection([a,b]))};
function game(grid){
 const ctx=vm.createContext({console,turf,URLSearchParams,window:{location:{search:'?city=chicago'}},localStorage:{getItem:()=>null},document:{getElementById:()=>null},navigator:{},fetch:()=>{throw Error('Network should not be needed');}});
 for(const name of ['00-cities.js','01-core.js'])vm.runInContext(fs.readFileSync(path.join(__dirname,'../assets/js/app',name),'utf8'),ctx);
 ctx.grid=grid;vm.runInContext('preloadedData.elevation=grid',ctx);return {run:code=>vm.runInContext(code,ctx),ctx};
}
const fixture={latitudes:[0,1],longitudes:[0,1],values:[[0,100],[0,100]],bbox:{west:0,south:0,east:1,north:1},pointLookup:'local-grid',interpolation:'triangulated-linear'};
test('local lookup and contour agree within a sloping cell, without a network request',async()=>{
 const g=game(fixture);assert.equal((await g.run('fetchPointElevation(.5,.25)')).feet,25);
 const f=g.run('buildElevationConstraintFeature({seeker_elevation_ft:40})');
 assert.equal(turf.booleanPointInPolygon(turf.point([.5,.5]),f),true);
 assert.equal(turf.booleanPointInPolygon(turf.point([.3,.5]),f),false);
 assert.ok(Math.abs(turf.area(f)/turf.area(turf.bboxPolygon([0,0,1,1]))-.6)<.0001);
 for(const [lat,lng] of [[.1,.2],[.8,.9],[1,1],[0,0]]) assert.equal(g.run(`interpolateGridElevation(grid,${lat},${lng})`),lng*100);
});
test('missing elevation is not silently converted to zero',async()=>{
 const g=game({...fixture,values:[[null,100],[0,100]]});
 await assert.rejects(g.run('fetchPointElevation(.5,.5)'),/outside/);
 assert.throws(()=>g.run('buildElevationConstraintFeature({seeker_elevation_ft:40})'),/Incomplete/);
 assert.equal(g.run('buildElevationConstraintFeature({seeker_elevation_ft:null})'),null);
 assert.equal(g.run('validElevationNumber(-1000000)'),false);
});
test('pinned Chicago grid has complete coverage, correct units and north/south orientation',async()=>{
 const data=JSON.parse(fs.readFileSync(path.join(__dirname,'../data/chicago/elevation-grid.json'))); const g=game(data);
 assert.equal(data.latitudes[0],41.6);assert.equal(data.latitudes.at(-1),42.12);assert.equal(data.longitudes[0],-88);assert.equal(data.longitudes.at(-1),-87.48);
 assert.equal(data.values.length,105);assert.ok(data.values.every(row=>row.length===105&&row.every(Number.isFinite)));
 const point=await g.run('fetchPointElevation(41.88,-87.63)');assert.ok(Math.abs(point.feet-593.617)<.1);
 await assert.rejects(g.run('fetchPointElevation(41.59,-87.63)'),/outside/);
 const contour=g.run('buildElevationConstraintFeature({seeker_elevation_ft:600})');
 assert.ok(contour.geometry.coordinates.length>0&&contour.geometry.coordinates.length<5000);
 for(const [lat,lng] of [[41.9,-87.7],[41.7,-87.8],[42,-87.9]]){
  const feet=g.run(`interpolateGridElevation(grid,${lat},${lng})`);
  assert.equal(turf.booleanPointInPolygon(turf.point([lng,lat]),contour),feet>=600);
 }
});
test('all-above and all-below contours are explicit regions',()=>{
 const g=game(fixture);assert.equal(g.run('buildElevationConstraintFeature({seeker_elevation_ft:101}).geometry.coordinates.length'),0);
 assert.equal(g.run('buildElevationConstraintFeature({seeker_elevation_ft:-1}).geometry.coordinates.length'),1);
});
test('elevation applies empty/full answers without the legacy no-op overlay fallback',()=>{
 const g=game(fixture);g.run('var z=turf.bboxPolygon([0,0,1,1]);');
 // Compute the contour from the question threshold for the current reduction scope.
 for(const [threshold,answer,empty] of [[101,'higher',true],[101,'lower',false],[-1,'higher',false],[-1,'lower',true]]){
  const result=g.run(`QDEFS.measure.applyToZone(z,{mode:'elevation',answer:'${answer}',seeker_elevation_ft:${threshold}})`);
  assert.equal(turf.area(result)===0,empty);
 }
});
