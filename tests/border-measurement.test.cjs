const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const turf=require('@turf/turf');
function game(city){
 const ctx=vm.createContext({console,turf,URLSearchParams,URL,setTimeout,clearTimeout,window:{location:{search:`?city=${city}`}},localStorage:{getItem:()=>null},document:{getElementById:()=>null},navigator:{}});
 for(const file of ['chicago-service','00-cities','linear-distance-filter','01-core','02-map','03-setup','04-build','05-hider','06-seeker','04-city-questions'])vm.runInContext(fs.readFileSync(path.join(__dirname,'../assets/js/app',file+'.js'),'utf8'),ctx,{filename:file});
 ctx.boundaries=JSON.parse(fs.readFileSync(path.join(__dirname,city==='boston'?'../data/boundaries.json':'../data/chicago/boundaries.json')));
 const run=code=>vm.runInContext(code,ctx);
 run('preloadedData.boundaries=boundaries;loadBoundaryData=async()=>boundaries');
 return {ctx,run};
}
for(const [id,center,oldDistance] of [
 ['city_border',{lat:42.44177465,lng:-71.05437745},1.320037385],
 ['county_border',{lat:42.6365975,lng:-71.2134274},2.311787792],
])test(`Boston ${id}: actual saved border midpoint uses segments, not vertices`,async()=>{
 const g=game('boston');g.ctx.center=center;g.ctx.id=id;
 const old=await g.run('Math.min(...getPreloadedBorderPoints(categorySpec("measure",id).boundaryKey).map(p=>turfDist(center,p)))');
 assert.ok(Math.abs(old-oldDistance)<0.00001,'fixture exposes the original vertex-distance error');
 const result=await g.run('resolveMeasurement(id,center)');
 assert.ok(result.value.dist<0.001,`border midpoint should be approximately zero miles away, got ${result.value.dist}`);
 assert.ok(result.linearFeatures.length>0);
 g.ctx.result=result;
 const question=g.run('QDEFS.measure.toJSON(measurementBuildParams(result))');
 assert.ok(question.linear_features.length>0,'zone geometry must buffer whole segments');
 g.ctx.question=question;
 const hider=await g.run('resolveMeasureValue(question,center)');
 assert.equal(hider.dist,result.value.dist);
 // Original legacy transport packets used a label rather than a stable category ID.
 g.ctx.payload={id:'legacy-border',type:'measure',category:id==='city_border'?'A City Border':'A County Border',center};
 const restored=await g.run('hydrateOutgoingQuestionContent(payload)');
 assert.equal(restored.seeker_dist,result.value.dist);
 assert.ok(restored.linear_features.length>0);
 g.ctx.payload={...g.ctx.payload,seeker_dist:old,all_instances:[center],seeker_nearest:center};
 const restoredFull=await g.run('hydrateOutgoingQuestionContent(payload)');
 assert.equal(restoredFull.seeker_dist,result.value.dist,'full legacy imports must not keep vertex-based context');
 assert.ok(restoredFull.linear_features.length>0);
 // A nonzero distance buffer must retain a point halfway along an edge even when
 // the nearest stored vertex is over a mile away.
 g.ctx.zone=turf.circle([center.lng,center.lat],0.15,{units:'miles'});
 const constraint=g.run('buildMeasureConstraintUnion({...question,seeker_dist:0.1},zone)');
 assert.ok(turf.booleanPointInPolygon(turf.point([center.lng,center.lat]),constraint));
});
for(const [city,id] of [['boston','city_border'],['boston','county_border'],['chicago','city_border'],['chicago','ward_border']])test(`${city} ${id}: shared boundary source uses linear geometry`,async()=>{
 const g=game(city);g.ctx.id=id;
 const result=await g.run(`(async()=>{const category=resolveCategory('measure',id);const features=await getMeasureLinearFeatures(category);return {mode:category.mode,key:category.boundaryKey,features}})()`);
 assert.equal(result.mode,'linear');assert.ok(result.key);assert.ok(result.features.length);
 assert.ok(result.features.every(item=>['LineString','MultiLineString'].includes(item.geometry.type)));
});
function resumeFixture(){
 const g=game('boston');
 g.run(`var messages=[],writes=0;toast=message=>messages.push(message);mbdataReady=true;
   var element={style:{},classList:{add(){},remove(){}}};document.getElementById=()=>element;
   setTimeout=()=>0;clearTimeout=()=>{};
   var oldBorder={id:'old-border',type:'measure',category:'A City Border',category_label:'A City Border',mode:'distance',center:{lat:42.44177465,lng:-71.05437745},seeker_dist:1.320037385,all_instances:[{lat:42.46,lng:-71.05}],answer:'further',_label:'Original observation'};
   var unanswered={...oldBorder,id:'outgoing'};delete unanswered.answer;
   var saved={hideRadiusMi:.25,gameMode:'hider',validZone:cloneGeo(INIT_POLY),constraints:[oldBorder],outgoingQuestions:{outgoing:unanswered},buildState:{qtype:'measure',qparams:contractBuildParams(unanswered),currentBuiltQuestion:unanswered,pickStep:-1}};
   loadSave=()=>saved;validateSavedCityQuestions=()=>{};applyHideRadiusVisuals=()=>{};applyGameMode=()=>{};recomputeZoneFromConstraints=()=>{};switchTab=()=>{};
   var restoredBuild=null;restoreSerializableBuildState=state=>{restoredBuild=state};saveGame=()=>{writes++};`);
 return g;
}
test('resume migrates legacy border constraints and all editor contexts, preserving historical answers',async()=>{
 const g=resumeFixture(),original=g.run('JSON.stringify(saved)');
 await g.run('resumeGame()');
 assert.equal(g.run('constraints[0].answer'),'further');
 assert.equal(g.run('constraints[0]._label'),'Original observation');
 for(const expr of ['constraints[0]','outgoingQuestions.outgoing','restoredBuild.currentBuiltQuestion']){
  assert.ok(g.run(`${expr}.seeker_dist`)<0.001);
  assert.ok(g.run(`${expr}.linear_features.length`)>0);
 }
 assert.ok(g.run('restoredBuild.qparams.measure_seeker_dist')<0.001);
 assert.ok(g.run('restoredBuild.qparams.measure_linear_features.length')>0);
 assert.match(g.run('messages.at(-1)'),/review 1 previous border answer/);
 assert.equal(g.run('writes'),1,'persist migration after restoring editor state');
 assert.equal(g.run('JSON.stringify(saved)'),original,'prepare migration must not mutate the source save');
 const already=await g.run('migrateSavedQuestionContexts({...saved,constraints,outgoingQuestions,buildState:restoredBuild})');
 assert.equal(already.count,0,'corrected contexts are migrated only once');
});
test('failed resume migration leaves active game and saved question contexts intact',async()=>{
 const g=resumeFixture();
 g.run("loadBoundaryData=async()=>{throw new Error('Boundary unavailable')};var beforeState=JSON.stringify({constraints,outgoingQuestions,validZone,hideRadiusMi,saved})");
 await g.run('resumeGame()');
 assert.equal(g.run('JSON.stringify({constraints,outgoingQuestions,validZone,hideRadiusMi,saved})'),g.run('beforeState'));
 assert.equal(g.run('restoredBuild'),null);assert.equal(g.run('writes'),0);
 assert.match(g.run('messages.at(-1)'),/Boundary unavailable/);
});
