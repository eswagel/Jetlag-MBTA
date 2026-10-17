const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const t = require('@turf/turf');
const turf = {...t, union:(a,b)=>t.union(t.featureCollection([a,b])),
  intersect:(a,b)=>t.intersect(t.featureCollection([a,b])),
  difference:(a,b)=>t.difference(t.featureCollection([a,b]))};
function game(city='chicago') {
  const ctx = vm.createContext({turf, console, URLSearchParams,
    window:{location:{search:`?city=${city}`}},localStorage:{getItem:()=>null}});
  for (const file of ['00-cities.js','01-core.js','03-setup.js']) {
    vm.runInContext(fs.readFileSync(`assets/js/app/${file}`,'utf8'),ctx);
  }
  return {ctx,run:source=>vm.runInContext(source,ctx)};
}
function sameRegion(actual,expected) {
  const missing=expected?(actual?turf.difference(expected,actual):expected):null;
  const extra=actual?(expected?turf.difference(actual,expected):actual):null;
  assert.ok((missing?turf.area(missing):0)+(extra?turf.area(extra):0)<.01);
}
test('indexed intersections and balanced unions preserve holes and disconnected or touching regions',()=>{
  const {ctx,run}=game();
  ctx.regions=[turf.polygon([[[0,0],[4,0],[4,4],[0,4],[0,0]],[[1,1],[1,3],[3,3],[3,1],[1,1]]]),
    turf.bboxPolygon([20,20,22,22]),turf.bboxPolygon([3,2,5,5])];
  const expected=ctx.regions.reduce((a,b)=>a?turf.union(a,b):b,null);
  sameRegion(run('unionCatchmentRegions(regions)'),expected);
  assert.equal(run('unionCatchmentRegions([null,emptyPolygonFeature()])'),null);
  ctx.region=expected;run('var index=indexPolygonRegion(region)');
  for(const bounds of [[-.5,-.5,.5,.5],[1.1,1.1,2.9,2.9],[4,0,6,1],[10,10,11,11],[-1,-1,25,25]]) {
    ctx.probe=turf.bboxPolygon(bounds);
    sameRegion(run('intersectIndexedRegion(probe,index)'),turf.intersect(ctx.probe,expected));
  }
});
test('real CTA red and green previews preserve the previous exact station and region results', {timeout:30000}, t=>{
  const {ctx,run}=game();ctx.transit=JSON.parse(fs.readFileSync('data/chicago/transit.json','utf8'));
  run(`for(const line of transit.lines) for(const stop of line.stops){
    const station=stopLineMap[stop.id] ||= {...stop,lines:new Set()};station.lines.add(line.id);
  } hideRadiusMi=.25;var base=buildHideRadiusZone();
  var clue={id:'radar-test',type:'radar',center:{lat:41.88,lng:-87.63},radius_miles:1};`);
  assert.equal(run('Object.keys(stopLineMap).length'),143);
  for(const answer of ['yes','no']) {
    ctx.answer=answer;const start=performance.now();
    run(`_survivingCatchmentCache=null;var optimized=deriveStopRegionState(base,[{...clue,answer}])`);
    const elapsed=performance.now()-start;
    t.diagnostic(`${answer}: optimized ${Math.round(elapsed)}ms`);
    assert.ok(elapsed<6000, `${answer} preview exceeded 6 seconds`);
    run(`var savedIntersect=intersectIndexedRegion;
      intersectIndexedRegion=(region,index)=>exactIsect(region,index.region);
      _survivingCatchmentCache=null;
      var reference=deriveStopRegionState(base,[{...clue,answer}]);
      intersectIndexedRegion=savedIntersect;`);
    sameRegion(run('optimized.hardUnion'),run('reference.hardUnion'));
    const actual=run('optimized.byStop'), expected=run('reference.byStop');
    for(const id of Object.keys(expected)) {
      assert.equal(actual[id].status,expected[id].status,`${answer}: ${id}`);
      sameRegion(actual[id].greenRegion,expected[id].greenRegion);
      sameRegion(actual[id].yellowRegion,expected[id].yellowRegion);
    }
  }
});
