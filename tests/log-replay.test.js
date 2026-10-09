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

function setup(g){g.run(`
  Object.assign(stopLineMap, {'1':{id:'1',name:'Test station',lat:ACTIVE_CITY.center[0],lng:ACTIVE_CITY.center[1],lines:new Set(['Red'])}});
  hideRadiusMi=.25; constraints=[{type:'_setup',answer:'applied',hide_radius_miles:.25}];
  validZone=buildHideRadiusZone();
`);}
const radar={id:'radar-a',type:'radar',center:{lat:41.9,lng:-87.7},radius_miles:5,answer:'yes'};
function log(city,radius=.5,entries=[radar]){return {kind:'jetlag_question_log',version:4,city_id:city,dataset_version:city+'-v1',hide_radius_miles:radius,constraints:[{type:'_setup',answer:'applied'},...entries]};}
for(const city of ['boston','chicago']) test(`${city}: log restores exported radius and preparing import leaves live game intact`,async()=>{
 const g=game(city);setup(g);g.ctx.payload=log(city);
 const before=g.run('JSON.stringify({hideRadiusMi,constraints,validZone})');
 g.ctx.payload.constraints[1].center=g.run('({lat:ACTIVE_CITY.center[0],lng:ACTIVE_CITY.center[1]})');
 const prepared=await g.run('prepareQuestionLog(payload)');
 assert.equal(prepared.radius,.5);assert.equal(prepared.constraints[1].answer,'yes');
 assert(turf.area(prepared.zone)>turf.area(g.run('validZone'))*3.9);
 assert.equal(g.run('JSON.stringify({hideRadiusMi,constraints,validZone})'),before);
 g.ctx.payload={...log(city),version:3,hide_radius_miles:undefined,constraints:[{type:'_setup',_label:'Hide radius: 2640 ft from any station'},radar]};
 assert.equal((await g.run('prepareQuestionLog(payload)')).radius,.5);
});
test('import validates cold local point references before zone calculation and rejects mismatches atomically',async()=>{
 const g=game();setup(g);
 g.run(`var loads=0; loadPoiData=async()=>{loads++;return preloadedData.pois={sources:{'poi-osm':{snapshotSha256:'snapshot-a'}},parks:[{name:'Park',lat:41.9,lng:-87.7}]}};`);
 g.ctx.payload=log('chicago',.25,[{id:'park-a',type:'measure',mode:'distance',category:'A Park',category_label:'A Park',center:{lat:41.9,lng:-87.7},answer:'closer',point_filter_version:'adaptive-point-v1',point_dataset:{dataset:'pois',key:'parks',version:'snapshot-a'}}]);
 const prepared=await g.run('prepareQuestionLog(payload)');
 assert(g.run('loads')>0);assert.equal(prepared.constraints[1].point_dataset.version,'snapshot-a');
 const before=g.run('JSON.stringify({hideRadiusMi,constraints,validZone})');
 g.ctx.payload.constraints[1].point_dataset.version='wrong';
 await assert.rejects(g.run('prepareQuestionLog(payload)'),/different local dataset/);
 assert.equal(g.run('JSON.stringify({hideRadiusMi,constraints,validZone})'),before);
});
test('invalid imports do not replace live state',async()=>{
 const g=game();setup(g);const before=g.run('JSON.stringify({hideRadiusMi,constraints,validZone})');
 for(const payload of [log('boston'),log('chicago',-1),log('chicago',.5,[{type:'unknown',answer:'yes'}]),log('chicago',.5,[{...radar,center:null}])]){
  g.ctx.payload=payload;await assert.rejects(g.run('prepareQuestionLog(payload)'));
  assert.equal(g.run('JSON.stringify({hideRadiusMi,constraints,validZone})'),before);
 }
});


test('invalid radius and coordinates are rejected and compact answers retain known question context',async()=>{
 const g=game();setup(g);
 for(const radius of [-1,0,null,'']){
  g.ctx.payload={...log('chicago').constraints[1],radius_miles:radius,city_id:'chicago',dataset_version:'chicago-v1'};
  delete g.ctx.payload.answer;
  await assert.rejects(g.run('hydrateOutgoingQuestion(payload)'),/radius/);
 }
 assert.equal(g.run('isLatLngLike({lat:null,lng:-87})'),false);
 assert.equal(g.run('isLatLngLike({lat:91,lng:-87})'),false);
 g.run(`currentBuiltQuestion={id:'compact',type:'radar',center:{lat:41.9,lng:-87.7},radius_miles:1};`);
 const answer=g.run(`resolveAnsweredQuestion({id:'compact',type:'radar',answer:'yes',city_id:'chicago',dataset_version:'chicago-v1'})`);
 assert.equal(answer.radius_miles,1);assert.equal(answer.center.lat,41.9);
 assert.throws(()=>g.run(`validateQuestionInputs({...currentBuiltQuestion,answer:'invalid'})`),/invalid answer/);
});

test('main v2 logs retain nested radius, compact boundaries and matching hydration',async()=>{
 const g=game('boston');setup(g);
 g.run(`resolveCategory('matching','city').resolve=async()=>({val:'Town',boundary:turf.bboxPolygon([-72,41,-70,44])});`);
 const rebuilt=await g.run(`hydrateOutgoingQuestion({id:'v2match',type:'matching',category:'city',center:{lat:42.36,lng:-71.06},seeker_val:'Town'})`);
 assert(rebuilt.boundary_geojson);
 g.ctx.legacy={version:2,game:{hide_radius_miles:.4},constraints:[{type:'custom_boundary',mode:'exclude',points:[{lat:40,lng:-73},{lat:40,lng:-72},{lat:41,lng:-72}]}]};
 const prepared=await g.run('prepareQuestionLog(legacy)');assert.equal(prepared.radius,.4);assert(prepared.constraints[0].boundary_geojson);
});
test('legacy manual overrides migrate or reject explicitly without losing actions',async()=>{
 const g=game('boston');setup(g);
 assert.equal(g.run(`migrateLegacyManualConstraint({type:'_yellow_harden',boundary_geojson:validZone}).type`),'custom_boundary');
 for(const type of ['_yellow_keep','_yellow_harden'])await assert.rejects(g.run(`migrateSavedQuestionContexts({constraints:[{type:'${type}'}]})`),/manual temporary-region/);
 assert.equal(g.run(`matchingValuesEqual('postcode','02139-1234','02139')`),true);
 assert.equal(g.run(`matchingValuesEqual('neighborhood','East Boston','Boston')`),false);
});
test('Boston preserves main water-edge distance with shared linear filtering',async()=>{
 const g=game('boston');
 g.run(`preloadedData.pois={bodiesOfWaterLines:[{name:'Edge',geometry:{type:'LineString',coordinates:[[-71,42],[-71,43]]}}]};loadPoiData=async()=>preloadedData.pois;`);
 const resolved=await g.run(`resolveMeasurement('water',{lat:42.5,lng:-71})`);assert(resolved.value.dist<.001);assert.equal(g.run(`measureFilterConfig('water').mode`),'adaptive-linear');
 assert.doesNotThrow(()=>g.run(`validateAdaptiveLinearQuestion({type:'measure',category:'A Body of Water'})`));
});
