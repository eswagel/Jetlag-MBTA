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
  for(const file of ['00-cities.js','01-core.js','02-map.js','03-setup.js','04-build.js','05-hider.js','06-seeker.js','04-city-questions.js']){
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
  g.run(`preloadedData.mbta={lines:[{id:'Purple-Express',stops:[]}]};fetchOptionalJSON=async()=>({});globalThis.ChicagoService={snapshot:()=>({status:'scheduled-active'})};`);
  await assert.rejects(g.run("resolveChicagoLine(null,{lineId:'Purple-Express'})"),/live confirmation is not connected/);
});


test('an imported claim of active Purple Express cannot bypass the absent live adapter',()=>{
  const g=game();
  g.run("preloadedData.mbta={lines:[{id:'Purple-Express',stops:[{id:'1'}]}]}");
  assert.throws(()=>g.run(`validateQuestionServiceSnapshot({type:'matching',category:'line',line_id:'Purple-Express',service_snapshot:{lineId:'Purple-Express',status:'active',source:'pretend-live',observedAt:'2026-10-07T13:00:00Z',stationIds:['1'],datasetVersion:'chicago-v1'}})`),/Imported claims cannot verify/);
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

test('large water geometry is blocked before map buffering or question import',async()=>{
  const g=game();
  assert.equal(g.run("buildMeasureConstraintUnion({type:'measure',category:'A Body of Water',seeker_dist:0.3,linear_features:[{geometry:{type:'MultiLineString',coordinates:[]}}]},INIT_POLY)"),null);
  await assert.rejects(g.run("hydrateOutgoingQuestion({id:'water',type:'measure',category:'A Body of Water',city_id:'chicago',dataset_version:'chicago-v1'})"),/not ready/);
  g.run("var warning='';toast=text=>warning=text");
  await g.run("selectMeasureCat({label:'A Body of Water'})");
  assert.match(g.run('warning'),/not ready/);
});
