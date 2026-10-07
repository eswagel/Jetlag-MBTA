const test=require('node:test'),assert=require('node:assert/strict');
const turf=require('@turf/turf');
const createFilter=require('../assets/js/app/linear-distance-filter.js');
const filter=createFilter(turf);
const line=(coords)=>turf.lineString(coords);
const inside=(point,geometry)=>geometry && turf.booleanPointInPolygon(turf.point(point),geometry);
const opts={maxCells:2048,maxDepth:12,resolutionMeters:15,slackMeters:2};

test('indexed nearest distance equals the complete original line geometry',()=>{
  const features=[line([[-87.9,41.8],[-87.65,42.0]]),line([[-87.7,41.6],[-87.6,41.7]])];
  const index=filter.indexFeatures(features);
  for(const p of [[-87.75,41.8],[-87.82,41.91],[-87.55,42.03],[-87.699,41.601]]){
    const expected=Math.min(...features.map(f=>turf.nearestPointOnLine(f,turf.point(p),{units:'miles'}).properties.dist));
    assert(Math.abs(index.nearest(p)-expected)<1e-8);
  }
});

test('certainty regions never exclude a location consistent with either answer',()=>{
  const features=[line([[-87.70,41.80],[-87.70,41.82]])];
  const zone=turf.bboxPolygon([-87.71,41.802,-87.69,41.818]), radius=.15;
  const result=filter.build(features,radius,zone,opts);
  let testedCloser=0,testedFurther=0;
  for(let x=0;x<=30;x++)for(let y=0;y<=20;y++){
    const p=[-87.71+x*.02/30,41.802+y*.016/20];
    const actual=turf.nearestPointOnLine(features[0],turf.point(p),{units:'miles'}).properties.dist;
    if(actual<=radius){assert(!inside(p,result.excludeForCloser));testedCloser++;}
    else{assert(!inside(p,result.excludeForFurther));testedFurther++;}
  }
  assert(testedCloser>0&&testedFurther>0);
  assert(inside([-87.7095,41.81],result.excludeForCloser));
  assert(inside([-87.70,41.81],result.excludeForFurther));
  assert(result.stats.cells<=opts.maxCells);
  assert(result.stats.uncertainCells>0);
});

test('features beyond the extent are measured without inventing clipped shore edges',()=>{
  const features=[line([[-87.70,41.8],[-87.70,41.9]])];
  const zone=turf.bboxPolygon([-87.698,41.83,-87.696,41.84]);
  // The entire line is outside the extent, but closer than the threshold.
  const result=filter.build(features,.4,zone,opts);
  assert.equal(result.excludeForCloser,null);
  assert(inside([-87.697,41.835],result.excludeForFurther));
  const far=filter.build(features,.01,zone,opts);
  assert(inside([-87.697,41.835],far.excludeForCloser));
  assert.equal(far.excludeForFurther,null);
});

test('zero radius, tiny budget and disconnected extents retain uncertainty safely',()=>{
  const features=[line([[-87.7,41.8],[-87.7,42]])];
  const zone=turf.multiPolygon([
    turf.bboxPolygon([-87.701,41.85,-87.699,41.86]).geometry.coordinates,
    turf.bboxPolygon([-87.711,41.95,-87.709,41.96]).geometry.coordinates,
  ]);
  const result=filter.build(features,0,zone,{...opts,maxCells:4});
  assert(result.stats.cells<=4);
  assert(!inside([-87.7,41.855],result.excludeForCloser));
  assert.equal(result.excludeForFurther,null);
  assert(inside([-87.71,41.955],result.excludeForCloser));
});

test('replay is deterministic and rejects invalid radii and unbounded resource options',()=>{
  const features=[line([[-87.7,41.8],[-87.7,42]])], zone=turf.bboxPolygon([-87.71,41.85,-87.69,41.86]);
  const a=filter.build(features,.1,zone,opts);
  const b=createFilter(turf).build(JSON.parse(JSON.stringify(features)),.1,zone,opts);
  assert.deepEqual(a,b);
  assert.throws(()=>filter.build(features,-1,zone),/threshold/);
  assert.throws(()=>filter.build(features,Infinity,zone),/threshold/);
  assert.throws(()=>filter.build(features,1,zone,{maxCells:1000000}),/limits/);
});

test('full Chicago source and envelope fit a bounded real-data performance budget',()=>{
  const {performance}=require('node:perf_hooks');
  const features=require('../data/chicago/pois.json').bodiesOfWaterLines;
  const local=createFilter(turf), zone=turf.bboxPolygon([-88,41.6,-87.48,42.12]);
  const start=performance.now(), result=local.build(features,.3,zone);
  const elapsed=performance.now()-start, rss=process.memoryUsage().rss, peak=process.resourceUsage().maxRSS*1024;
  console.log(`Chicago water filter: ${elapsed.toFixed(0)}ms, ${(rss/1048576).toFixed(0)}MiB RSS (${(peak/1048576).toFixed(0)}MiB peak), ${result.stats.cells} cells, ${result.stats.segments} source segments`);
  assert(result.stats.segments>150000);
  assert(result.stats.cells<=24000);
  assert(elapsed<15000,'desktop stress test exceeded 15s; investigate rather than enable a phone-freezing filter');
  assert(peak<512*1048576,'bounded filter exceeded 512MiB peak RSS');
  const transit=require('../data/chicago/transit.json');
  const stations=[...new Map(transit.lines.flatMap(l=>l.stops).map(s=>[s.id,s])).values()];
  const index=local.indexFeatures(features);
  for(const station of stations){
    const p=[station.lng,station.lat], actual=index.nearest(p);
    assert(!inside(p,actual<=.3?result.excludeForCloser:result.excludeForFurther),station.name);
  }
  // Near ordinary gameplay locations, smaller disconnected station regions allow
  // finer resolution without increasing the resource budget.
  const small=turf.circle([-87.6298,41.8781],.25,{units:'miles'});
  const focused=local.build(features,.1,small);
  assert(focused.stats.maxUncertainDiameterMeters<50);
});
