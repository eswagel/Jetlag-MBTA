const test=require('node:test'), assert=require('node:assert/strict');
const fs=require('node:fs'), vm=require('node:vm'), path=require('node:path');
const turf7=require('@turf/turf');
const turf={...turf7,union:(a,b)=>turf7.union(turf7.featureCollection([a,b])),difference:(a,b)=>turf7.difference(turf7.featureCollection([a,b])),intersect:(a,b)=>turf7.intersect(turf7.featureCollection([a,b]))};
const createFilter=require('../assets/js/app/linear-distance-filter.js');
function game(city='chicago'){
  const ctx=vm.createContext({console,turf,URLSearchParams,URL,setTimeout,clearTimeout,
    window:{location:{search:`?city=${city}`}},localStorage:{getItem:()=>null},document:{getElementById:()=>null},navigator:{}});
  for(const file of ['chicago-service.js','00-cities.js','linear-distance-filter.js','01-core.js','02-map.js','03-setup.js','04-build.js','05-hider.js','06-seeker.js','04-city-questions.js']) vm.runInContext(fs.readFileSync(path.join(__dirname,'../assets/js/app',file),'utf8'),ctx,{filename:file});
  return {ctx,run:code=>vm.runInContext(code,ctx)};
}
const fixture=`preloadedData.pois={sources:{'poi-osm':{snapshotSha256:'fixture-v1'}},parks:[
  ...Array.from({length:201},(_,i)=>({lat:42.02+i*.000001,lng:-87.9,name:'North park '+i})),
  {lat:41.72,lng:-87.6,name:'Distant south park'}]};loadPoiData=async()=>preloadedData.pois;`;
const inside=(p,g)=>!!g&&turf.booleanPointInPolygon(turf.point(p),g);

test('full local point data survives the former 200-instance and 35km cutoffs and compact replay',async()=>{
  const g=game();g.run(fixture);
  assert.equal(await g.run("getCategoryInstances(MEASURE_CATS.find(c=>c.label==='A Park'),{lat:42.02,lng:-87.903},35000).then(x=>x.length)"),202);
  g.run(`var original=QDEFS.measure.toJSON({center:{lat:42.02,lng:-87.903},measure_cat:'A Park',measure_cat_label:'A Park',measure_seeker_dist:.154,measure_all_instances:preloadedData.pois.parks});original.id='point';`);
  const packet=g.run('buildQuestionPacket(original)');g.ctx.packet=packet;
  assert(JSON.stringify(packet).length<1000);
  assert.equal(packet.point_dataset.key,'parks');
  await assert.doesNotReject(g.run("hydrateOutgoingQuestion({...packet,point_dataset:{version:packet.point_dataset.version,key:packet.point_dataset.key,dataset:packet.point_dataset.dataset}})"));
  const hydrated=await g.run('hydrateOutgoingQuestion(packet)');g.ctx.hydrated=hydrated;
  assert.equal(hydrated.all_instances.length,0,'No source arrays in a saved question');
  assert(hydrated.seeker_dist>.1 && hydrated.seeker_dist<.2);
  const nearest=await g.run("resolveMeasureValue(hydrated,{lat:41.72,lng:-87.6})");
  assert.equal(nearest.name,'Distant south park');
  assert(nearest.dist<1e-8);
  g.run('var southZone=turf.bboxPolygon([-87.6005,41.7195,-87.5995,41.7205]);');
  const kept=g.run("QDEFS.measure.applyToZone(southZone,{...hydrated,answer:'closer'})");
  assert(inside([-87.6,41.72],kept),'The remote park must protect a valid hider from false elimination');
  const first=g.run('buildAdaptiveLinearConstraint(hydrated,southZone)');
  const replay=await g.run('hydrateOutgoingQuestion(packet)');g.ctx.replay=replay;
  assert.deepEqual(JSON.parse(JSON.stringify(first)),JSON.parse(g.run('JSON.stringify(buildAdaptiveLinearConstraint(replay,southZone))')));
  await assert.rejects(g.run("hydrateOutgoingQuestion({...packet,point_dataset:{...packet.point_dataset,version:'other'}})"),/different local dataset/);
  await assert.rejects(g.run("hydrateOutgoingQuestion({...packet,point_filter_version:'old'})"),/old map-filter version/);
});

test('empty certified geometry stays empty and profiles retain Boston legacy compatibility',async()=>{
  const g=game();g.run(fixture);
  g.run(`var question={...QDEFS.measure.toJSON({center:{lat:42.02,lng:-87.9},measure_cat:'A Park',measure_cat_label:'A Park',measure_seeker_dist:0}),answer:'closer'};`);
  const empty=g.run('QDEFS.measure.applyToZone(turf.bboxPolygon([-87.8,41.8,-87.79,41.81]),question)');
  assert.equal(empty.geometry.type,'MultiPolygon');assert.equal(empty.geometry.coordinates.length,0);
  const boston=game('boston');
  assert.equal(boston.run("adaptivePointConfig('A Park')"),null);
  boston.run("var legacy=QDEFS.measure.toJSON({measure_cat:'A Park',measure_cat_label:'A Park',measure_seeker_dist:1,measure_all_instances:[{lat:42.3,lng:-71.1}]})");
  assert.equal(boston.run('legacy.all_instances.length'),1);
  assert.doesNotThrow(()=>boston.run('validateAdaptiveLinearQuestion(legacy)'));
  // A future city can opt in with a differently named source, without renderer branches.
  boston.run("ACTIVE_CITY.measureFilters=pointMeasureFilters({'A Park':'futureParks'});preloadedData.pois={sources:{'poi-osm':{snapshotSha256:'future-v1'}},futureParks:[{lat:42.3,lng:-71.1}]};loadPoiData=async()=>preloadedData.pois");
  assert.equal((await boston.run("loadPointDistanceData('A Park')")).length,1);
  assert.equal(boston.run("pointDistanceMetadata('A Park').point_dataset.key"),'futureParks');
});

test('point index agrees with complete exact distances, including duplicates and remote points',()=>{
  const points=[turf.point([-87.9,42]),turf.point([-87.6,41.72]),turf.point([-87.6,41.72])];
  const filter=createFilter(turf),index=filter.indexFeatures(points);
  for(const p of [[-87.6,41.72],[-87.7,41.8],[-87.8,41.95]]){
    const expected=Math.min(...points.map(f=>turf.distance(turf.point(p),f,{units:'miles'})));
    assert(Math.abs(index.nearest(p)-expected)<1e-8);
  }
  assert.throws(()=>filter.indexFeatures([{geometry:{type:'Point',coordinates:[NaN,42]}}]),/Invalid point/);
});

test('all 3230 Chicago parks fit a bounded filter and preserve exact answers at CTA stops',()=>{
  const points=require('../data/chicago/pois.json').parks.map(p=>turf.point([p.lng,p.lat]));
  const filter=createFilter(turf),zone=turf.bboxPolygon([-88,41.6,-87.48,42.12]);
  const start=performance.now(),result=filter.build(points,.2,zone),elapsed=performance.now()-start;
  console.log(`Chicago parks: ${points.length} points, ${elapsed.toFixed(0)}ms, ${result.stats.cells} cells`);
  assert.equal(result.stats.segments,points.length);assert(result.stats.cells<=24000);
  assert(elapsed<10000,'Point filter exceeded 10-second desktop stress budget');
  const stations=[...new Map(require('../data/chicago/transit.json').lines.flatMap(l=>l.stops).map(s=>[s.id,s])).values()];
  for(const station of stations){
    const p=[station.lng,station.lat];
    const exact=Math.min(...points.map(f=>turf.distance(p,f,{units:'miles'})));
    assert(!inside(p,exact<=.2?result.excludeForCloser:result.excludeForFurther),station.name);
  }
});

test('commuter rail loads its own full source and binds both Metra and South Shore feed hashes',async()=>{
  const g=game();const data=require('../data/chicago/transit.json');
  g.ctx.fetch=async()=>({ok:true,json:async()=>data});
  const points=await g.run("loadPointDistanceData('A Commuter Rail Station')");
  assert.equal(points.length,260);
  g.run("var rail=QDEFS.measure.toJSON({center:{lat:41.88,lng:-87.63},measure_cat:'A Commuter Rail Station',measure_cat_label:'A Commuter Rail Station',measure_seeker_dist:1})");
  assert.equal(g.run('rail.point_dataset.version'),`${data.sources.metra.sha256}:${data.sources.southshore.sha256}`);
  assert.doesNotThrow(()=>g.run('validateAdaptiveLinearQuestion(rail)'));
  assert.throws(()=>g.run("validateAdaptiveLinearQuestion({...rail,point_dataset:{...rail.point_dataset,version:'stale-Metra'}})"),/different local dataset/);
});
