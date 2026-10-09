const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
function game(city){
 const c=vm.createContext({console,URLSearchParams,window:{location:{search:'?city='+city}},localStorage:{getItem:()=>null},navigator:{},document:{getElementById:()=>({style:{},classList:{add(){},remove(){}}})},turf:{polygon:coordinates=>({type:'Feature',geometry:{type:'Polygon',coordinates}})}});
 for(const f of ['00-cities.js','01-core.js','03-setup.js','04-build.js'])vm.runInContext(fs.readFileSync('assets/js/app/'+f,'utf8'),c);
 const run=s=>vm.runInContext(s,c);
 run(`qtype='matching';qparams={center:{lat:41.8,lng:-87.6},matching_cat:'neighbourhood',matching_seeker_val:'Hyde Park',matching_boundary:{old:true},_matching_boundary_simplified:{old:true}};pickStepDefs=QDEFS.matching.pickSteps;clearMarkers=()=>{};clearPoiMarkers=()=>{};previewLayer={clearLayers(){}};clearZonePreview=()=>{};showBanner=()=>{};renderBuildBody=()=>{};highlightBoundary=()=>{};tryGenerate=()=>{};toast=()=>{};isChicagoGame=()=>true;`);
 return run;
}
for(const city of ['boston','chicago']){
 test(city+': repick clears matching geometry and resolves the retained category at new point',async()=>{
 const run=game(city);run('restartPick()');assert.equal(run('qparams.matching_cat'),'neighbourhood');assert.equal(run('qparams.matching_seeker_val'),undefined);assert.equal(run('qparams._matching_boundary_simplified'),undefined);assert.equal(run('currentBuiltQuestion'),null);
 await run(`qparams.center={lat:41.87,lng:-87.63};selectMatchingCat({cat:'neighbourhood',label:'Community Area',resolve:async p=>({val:p.lat===41.87?'Near South Side':'Hyde Park',boundary:{new:true}})})`);
 assert.equal(run('qparams.matching_seeker_val'),'Near South Side');assert.equal(run('qparams._matching_boundary_simplified.new'),true);
 });
 test(city+': old lookup cannot overwrite the result after repicking',async()=>{
 const run=game(city);run(`var finishOld;var oldRequest=selectMatchingCat({cat:'neighbourhood',label:'Community Area',resolve:()=>new Promise(r=>finishOld=r)});restartPick();qparams.center={lat:41.87,lng:-87.63};`);
 await run(`selectMatchingCat({cat:'neighbourhood',label:'Community Area',resolve:async()=>({val:'Near South Side',boundary:{new:true}})})`);
 await run(`finishOld({val:'Hyde Park',boundary:{old:true}});oldRequest`);
 assert.equal(run('qparams.matching_seeker_val'),'Near South Side');assert.equal(run('qparams.matching_boundary.new'),true);
 });
}

for(const city of ['boston','chicago']){
 for(const type of ['radar','thermo','measure','tentacles','matching','nearest']){
  test(city+': '+type+' uses shared pick invalidation and retains only user inputs',()=>{
   const run=game(city);
   run(`qtype='${type}';qparams={center:{lat:1,lng:2},radius_miles:2,travel_miles:3,measure_cat:'A Park',_tcat:'Parks',matching_cat:'city',nearest_cat:'Park',measure_seeker_dist:5,measure_constraint_union:{old:true},tentacle_options:[{old:true}],thermo_dest:{lat:3,lng:4},future_computed_field:{old:true}};pickStepDefs=QDEFS[qtype].pickSteps;restartPick();`);
   assert.equal(run('qparams.center'),undefined);
   for(const key of ['measure_seeker_dist','measure_constraint_union','tentacle_options','thermo_dest','future_computed_field']) assert.equal(run('qparams.'+key),undefined,key);
   assert.equal(run('qparams.radius_miles'),2);assert.equal(run('qparams.travel_miles'),3);
   assert.equal(run('qparams.measure_cat'),'A Park');assert.equal(run('qparams._tcat'),'Parks');
  });
 }
 for(const type of ['measure','tentacles']){
  test(city+': stale '+type+' completion cannot restore results after repick',async()=>{
   const run=game(city);
   run(`qtype='${type}';pickStepDefs=QDEFS[qtype].pickSteps;cityQuestionUnavailableReason=()=>null;clearBoundaryHighlight=()=>{};isSeaLevelMeasure=()=>false;isLinearMeasure=()=>false;var finish;getCategoryInstances=()=>new Promise(r=>finish=r);resolveTentacleQuestionOptions=()=>new Promise(r=>finish=r);var request=${type==='measure'?'selectMeasureCat':'selectTentacleCat'}({label:'A Park'});restartPick();`);
   await run(`finish([{name:'Old',lat:1,lng:2},{name:'Old2',lat:2,lng:3}]);request`);
   assert.equal(run('qparams.measure_seeker_dist'),undefined);
   assert.equal(run('qparams.tentacle_options'),undefined);
   assert.equal(run('currentBuiltQuestion'),null);
  });
 }
}

for(const city of ['boston','chicago']){
 test(city+': GPS and map picks share completion and reject obsolete GPS callbacks',()=>{
  const run=game(city);
  run(`qtype='radar';pickStepDefs=QDEFS.radar.pickSteps;pickStep=0;qparams={radius_miles:2};var gpsDone;var generated=0;navigator.geolocation={getCurrentPosition:done=>gpsDone=done};L={marker:()=>({addTo:()=>({})})};seekerPin=()=>null;map={setView(){},getZoom:()=>12};hideBanner=()=>{};updatePreview=()=>{};generateJSON=()=>generated++;useMyLocation('center',0);applyPickedPoint(41,-87);gpsDone({coords:{latitude:42,longitude:-71,accuracy:5}});`);
  assert.equal(run('qparams.center.lat'),41);assert.equal(run('generated'),1);
  run(`restartPick();useMyLocation('center',0);gpsDone({coords:{latitude:42,longitude:-71,accuracy:5}});`);
  assert.equal(run('qparams.center.lat'),42);assert.equal(run('generated'),2);assert.equal(run('pickStep'),1);
 });
 test(city+': measure elevation and tentacle options resolve from replacement center',async()=>{
  const run=game(city);
  run(`qtype='measure';pickStepDefs=QDEFS.measure.pickSteps;qparams.measure_cat='Sea Level';restartPick();qparams.center={lat:43,lng:-71};cityQuestionUnavailableReason=()=>null;clearBoundaryHighlight=()=>{};isSeaLevelMeasure=()=>true;loadElevationData=async()=>({values:[[1]]});fetchPointElevation=async lat=>({feet:lat,meters:lat/3});updatePreview=()=>{};`);
  await run(`selectMeasureCat({label:'Sea Level'})`);assert.equal(run('qparams.measure_seeker_elevation_ft'),43);
  run(`qtype='tentacles';pickStepDefs=QDEFS.tentacles.pickSteps;qparams._tcat='Parks';restartPick();qparams.center={lat:44,lng:-72};resolveTentacleQuestionOptions=async(label,center)=>[{name:'New1',...center},{name:'New2',...center}];renderTentacleOptionPins=()=>{};`);
  await run(`selectTentacleCat({label:'Parks'})`);assert.equal(run('qparams.tentacle_options[0].lat'),44);
 });
}
