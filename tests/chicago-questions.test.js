const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const turf7 = require('@turf/turf');
// The browser uses Turf 6 binary overlay signatures; adapt installed Turf 7 for these tests.
const turf = {...turf7,
  union:(a,b)=>turf7.union(turf7.featureCollection([a,b])),
  difference:(a,b)=>turf7.difference(turf7.featureCollection([a,b])),
  intersect:(a,b)=>turf7.intersect(turf7.featureCollection([a,b])),
};
function game(city='chicago'){
  const ctx = vm.createContext({console, turf, URLSearchParams, URL, setTimeout, clearTimeout,
    window:{location:{search:`?city=${city}`}}, localStorage:{getItem:()=>null},
    document:{getElementById:()=>null}, navigator:{},
  });
  for(const file of ['chicago-service.js','00-cities.js','linear-distance-filter.js','01-core.js','02-map.js','03-setup.js','04-build.js','05-hider.js','06-seeker.js','04-city-questions.js']){
    vm.runInContext(fs.readFileSync(path.join(__dirname,'../assets/js/app',file),'utf8'),ctx,{filename:file});
  }
  return {ctx,run:code=>vm.runInContext(code,ctx)};
}
const lineFixture = `
  preloadedData.mbta={feedVersion:'feed-a',lines:[{id:'Red',stops:[{id:'1',name:'One',lat:41.9,lng:-87.7},{id:'2',name:'Two',lat:41.91,lng:-87.7}]}]};
  Object.assign(stopLineMap, {'1':{id:'1',name:'One',lat:41.9,lng:-87.7,lines:new Set(['Red'])},'2':{id:'2',name:'Two',lat:41.91,lng:-87.7,lines:new Set(['Red'])}});
`;

test('Chicago matching categories and labels are independent of Boston',()=>{
  const chicago=game(); const boston=game('boston');
  assert.deepEqual(JSON.parse(chicago.run('JSON.stringify(MATCHING_CATS.map(c=>c.cat))')),
    ['line','landmass','city','ward','community_area','postcode']);
  assert.equal(chicago.run("MEASURE_CATS.some(c=>c.label==='Elevation')"),true);
  assert.equal(chicago.run("MEASURE_CATS.some(c=>c.label==='Lake Michigan shoreline')"),true);
  assert.equal(boston.run("MATCHING_CATS.some(c=>c.cat==='county')"),true);
  assert.equal(boston.run("MEASURE_CATS.some(c=>c.label==='Sea Level')"),true);
  assert.equal(chicago.run('TENTACLES_CATS.some(c=>c.overpass)'),false);
});

test('outside Chicago ward resolves to actual polygon complement; missing inside data errors',async()=>{
  const g=game();
  g.run(`preloadedData.boundaries={municipalities:[{name:'Chicago',geometry:turf.bboxPolygon([-87.8,41.7,-87.6,42]).geometry}],wards:[]}; loadBoundaryData=async()=>preloadedData.boundaries;`);
  const outside=await g.run("resolveChicagoBoundary('ward',{lat:42.05,lng:-87.7})");
  assert.equal(outside.val,'Outside Chicago');
  assert.equal(turf.booleanPointInPolygon(turf.point([-87.7,42.05]),outside.boundary),true);
  assert.equal(turf.booleanPointInPolygon(turf.point([-87.7,41.9]),outside.boundary),false);
  await assert.rejects(g.run("resolveChicagoBoundary('ward',{lat:41.9,lng:-87.7})"),/No verified ward/);
});

test('line snapshot survives question packet import and uses station IDs',async()=>{
  const g=game(); g.run(lineFixture);
  const result=await g.run("resolveChicagoLine(null,{lineId:'Red',hideRadiusMiles:0.25})");
  g.ctx.snapshot=result.service_snapshot;
  const packet=g.run(`buildQuestionPacket({id:'test',type:'matching',category:'line',category_label:'CTA Line',line_id:'Red',seeker_val:'Red Line',center:{lat:41.9,lng:-87.7},service_snapshot:snapshot})`);
  assert.equal(packet.city_id,'chicago');
  assert.equal(packet.dataset_version,'chicago-v1');
  g.ctx.packet=packet;
  const restored=await g.run('hydrateOutgoingQuestion(packet)');
  assert.deepEqual(JSON.parse(JSON.stringify(restored.service_snapshot)),JSON.parse(JSON.stringify(result.service_snapshot)));
  assert.equal(g.run("stationMatchesQuestionLine({id:'1',lines:[]},packet)"),true);
  assert.equal(g.run("stationMatchesQuestionLine({id:'3',lines:['Red']},packet)"),false);
});

test('static snapshots reject version mismatch, station subsets and duplicates',async()=>{
  const g=game(); g.run(lineFixture);
  const result=await g.run("resolveChicagoLine(null,{lineId:'Red'})");
  g.ctx.snapshot=result.service_snapshot;
  g.run("var question={type:'matching',category:'line',line_id:'Red',service_snapshot:snapshot}");
  assert.throws(()=>g.run("validateQuestionServiceSnapshot({...question,service_snapshot:{...snapshot,datasetVersion:'wrong'}})"),/different dataset/);
  assert.throws(()=>g.run("validateQuestionServiceSnapshot({...question,service_snapshot:{...snapshot,stationIds:['1']}})"),/outside this dataset/);
  assert.throws(()=>g.run("validateQuestionServiceSnapshot({...question,service_snapshot:{...snapshot,stationIds:['1','1']}})"),/outside this dataset/);
});

test('answered JSON cannot bypass city or service snapshot checks',()=>{
  const g=game(); g.run(lineFixture);
  g.run('var applied=false; var message=""; toast=text=>message=text; applyAnswerObject=()=>applied=true;');
  g.run(`applyAnswerFromRaw(JSON.stringify({id:'bad',type:'matching',category:'line',line_id:'Red',answer:'Yes',city_id:'chicago',dataset_version:'chicago-v1'}),()=>{});`);
  assert.equal(g.run('applied'),false);
  assert.match(g.run('message'),/snapshot/);
  g.run(`applyAnswerFromRaw(JSON.stringify({id:'bad',answer:'Yes',city_id:'boston',dataset_version:'boston-v1'}),()=>{});`);
  assert.equal(g.run('applied'),false);
  assert.match(g.run('message'),/belongs to boston/);
});

test('water measurement uses nearest point on an edge instead of its center',async()=>{
  const g=game();
  g.run(`preloadedData.pois={bodiesOfWaterLines:[{name:'Water edge',geometry:{type:'LineString',coordinates:[[-87.7,41.8],[-87.7,42.0]]}}]}; loadPoiData=async()=>preloadedData.pois;`);
  const value=await g.run("resolveMeasureValue({category:'A Body of Water',mode:'distance'},{lat:41.81,lng:-87.69})");
  assert.ok(value.dist>0.4 && value.dist<0.7,`distance ${value.dist}`);
});

test('Purple Express cannot be created from schedule-only evidence',async()=>{
  const g=game();
  g.run(`preloadedData.mbta={lines:[{id:'Purple-Express',stops:[{id:'1'}]}]};fetchOptionalJSON=async()=>({});globalThis.ChicagoService={snapshot:()=>({status:'scheduled-active'})};`);
  await assert.rejects(g.run("resolveChicagoLine(null,{lineId:'Purple-Express'})"),/Purple Express is now part of Purple Line|Line data is not available/);
});


test('an imported claim of active Purple Express cannot bypass the absent live adapter',()=>{
  const g=game();
  g.run("preloadedData.mbta={lines:[{id:'Purple-Express',stops:[{id:'1'}]}]}");
  assert.throws(()=>g.run(`validateQuestionServiceSnapshot({type:'matching',category:'line',line_id:'Purple-Express',service_snapshot:{lineId:'Purple-Express',status:'active',source:'pretend-live',observedAt:'2026-10-07T13:00:00Z',stationIds:['1'],datasetVersion:'chicago-v1'}})`),/Purple Express is now part of Purple Line/);
});

test('line snapshots reject a different source feed even with the same station IDs',async()=>{
  const g=game(); g.run(lineFixture);
  const result=await g.run("resolveChicagoLine(null,{lineId:'Red'})");
  g.ctx.snapshot=result.service_snapshot;
  g.run("preloadedData.mbta.feedVersion='feed-b'");
  assert.throws(()=>g.run("validateQuestionServiceSnapshot({type:'matching',category:'line',line_id:'Red',service_snapshot:snapshot})"),/different CTA source feed/);
});

test('saved Chicago games validate feed and nested line snapshots before resuming',()=>{
  const g=game(); g.run(lineFixture);
  assert.throws(()=>g.run("validateSavedCityQuestions({transit_feed_version:'old',constraints:[]})"),/different CTA feed/);
  assert.throws(()=>g.run("validateSavedCityQuestions({transit_feed_version:'feed-a',outgoingQuestions:{bad:{type:'matching',category:'line',line_id:'Red'}}})"),/snapshot/);
  assert.doesNotThrow(()=>g.run("validateSavedCityQuestions({transit_feed_version:'feed-a',constraints:[]})"));
});

test('water filtering is versioned and enabled through shared profile configuration',async()=>{
  const g=game();
  g.run(`preloadedData.pois={bodiesOfWaterLines:[{name:'Water edge',geometry:{type:'LineString',coordinates:[[-87.7,41.8],[-87.7,42.0]]}}]}; loadPoiData=async()=>preloadedData.pois;`);
  const packet={id:'water',type:'measure',category:'A Body of Water',category_label:'A Body of Water',center:{lat:41.81,lng:-87.69},city_id:'chicago',dataset_version:'chicago-v1',linear_filter_version:'adaptive-linear-v1'};
  g.ctx.packet=packet;
  const restored=await g.run('hydrateOutgoingQuestion(packet)');
  assert.equal(restored.linear_filter_version,'adaptive-linear-v1');
  assert.equal(restored.linear_features.length,0,'Local source geometry must not be duplicated in questions or saves');
  assert(JSON.stringify(restored).length<4000,'Adaptive question stays below ordinary localStorage limits');
  g.ctx.restored=restored;
  const outgoing=g.run('buildQuestionPacket(restored)');
  assert.equal(outgoing.linear_filter_version,'adaptive-linear-v1');
  assert.equal(g.run('cityQuestionUnavailableReason(packet)'),null);
  g.run('var smallZone=turf.bboxPolygon([-87.705,41.808,-87.695,41.812])');
  const kept=g.run("QDEFS.measure.applyToZone(smallZone,{...restored,answer:'closer'})");
  assert(kept);
  assert.equal(g.run("QDEFS.measure.applyToZone(turf.bboxPolygon([-87.69,41.808,-87.685,41.812]),{...restored,seeker_dist:.001,answer:'closer'})"),null,'A fully contradicted region must not silently return the original zone');
  await assert.rejects(g.run("hydrateOutgoingQuestion({...packet,linear_filter_version:'unknown'})"),/different map-filter version/);
  const boston=game('boston');
  assert.equal(boston.run("adaptiveLinearConfig({type:'measure',category:'A Body of Water'})"),null);
});


test('single Purple question uses saved schedule fallback and replays its original service time',async()=>{
  const g=game();
  g.ctx.ChicagoService=require('../assets/js/app/chicago-service.js');
  g.ctx.transit=require('../data/chicago/transit.json');
  g.ctx.calendar=require('../data/chicago/service-calendar.json');
  g.run("preloadedData.mbta=transit;fetchOptionalJSON=async()=>calendar;toast=()=>{}");
  const result=await g.run("resolveChicagoLine(null,{lineId:'Purple',observedAt:'2026-10-07T13:00:00Z'})");
  assert.equal(result.service_snapshot.source,'cta-gtfs-schedule');
  assert(result.service_snapshot.stationIds.includes('41700'));
  assert.equal(result.service_snapshot.feedVersion,g.ctx.transit.feedVersion);
  g.ctx.saved=result.service_snapshot;
  const reloaded=await g.run("resolveChicagoLine(null,{lineId:'Purple',serviceSnapshot:saved,observedAt:'2026-10-07T17:00:00Z'})");
  assert.equal(reloaded.service_snapshot.observedAt,'2026-10-07T13:00:00.000Z');
  assert(reloaded.service_snapshot.stationIds.includes('41700'));
  assert.throws(()=>g.run("validateQuestionServiceSnapshot({type:'matching',category:'line',line_id:'Purple',service_snapshot:{...saved,stationIds:['41050']}})"),/does not match/);
});


test('Amtrak labels retain supplied route identity across cities and unknown routes',()=>{
  for(const city of ['boston','chicago']){
    const g=game(city);
    for(const name of ['Hiawatha Service','California Zephyr','Southwest Chief','Future City Train']){
      assert.equal(g.run(`amtrakLineLabel(${JSON.stringify(name)})`),name);
    }
    assert.equal(g.run("amtrakLineLabel('Amtrak Northeast Corridor')"),'Northeast Corridor');
    assert.equal(g.run("amtrakLineLabel(null)"),'Amtrak');
    assert.equal(g.run("amtrakLineLabel('Long Name',{shortName:'Source Label'})"),'Source Label');
  }
});

test('another profile can enable the same bounded edge filter without Chicago branches',async()=>{
  const g=game('boston');
  g.run(`ACTIVE_CITY.measureFilters={'A Body of Water':{mode:'adaptive-linear',version:'adaptive-linear-v1',dataKey:'riverEdges'}};
    preloadedData.pois={riverEdges:[{type:'Feature',properties:{name:'Example river'},geometry:{type:'LineString',coordinates:[[-71.1,42.2],[-71.1,42.4]]}}]}; loadPoiData=async()=>preloadedData.pois;`);
  assert.equal(g.run("isLinearMeasure('A Body of Water')"),true);
  const value=await g.run("resolveMeasureValue({category:'A Body of Water',mode:'distance'},{lat:42.3,lng:-71.099})");
  assert.equal(value.name,'Example river');
  assert(value.dist>0&&value.dist<.1);
  assert.equal(g.run("adaptiveLinearConfig({type:'measure',category:'A Body of Water'}).dataKey"),'riverEdges');
});


test('the browser entrypoint loads the shared filter before the engine',()=>{
  const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
  assert(html.indexOf('assets/js/app/linear-distance-filter.js')>=0);
  assert(html.indexOf('assets/js/app/linear-distance-filter.js')<html.indexOf('assets/js/app/01-core.js'));
});
