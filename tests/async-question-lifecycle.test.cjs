const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
function game(city){
 const elements = new Map();
 const c = vm.createContext({console, URLSearchParams, window:{location:{search:'?city='+city}}, localStorage:{getItem:()=>null}, navigator:{}, document:{getElementById(id){if(!elements.has(id)) elements.set(id,{value:'',style:{},classList:{add(){},remove(){}}});return elements.get(id);},querySelectorAll:()=>[]}, turf:{polygon:coordinates=>({type:'Feature',geometry:{type:'Polygon',coordinates}})}});
 for(const f of ['00-cities.js','01-core.js','03-setup.js','04-build.js','05-hider.js','06-seeker.js']) vm.runInContext(fs.readFileSync('assets/js/app/'+f,'utf8'),c);
 const run = s=>vm.runInContext(s,c);
 run(`var notices=[], results=[];toast=m=>notices.push(m);showHiderResult=json=>results.push(JSON.parse(json));stampCityPayload=q=>q;renderBuildBody=()=>{};renderHiderStationBadge=()=>{};clearZonePreview=()=>{};clearPoiMarkers=()=>{};updatePreview=()=>{};renderTentacleOptionPins=()=>{};tryGenerate=()=>{};switchTab=()=>{};L={marker:()=>({addTo:()=>({remove(){}})})};hiderPin=()=>null;map={setView(){},getZoom:()=>12};turfDist=(a,b)=>Math.abs(a.lat-b.lat);var gps=[];navigator.geolocation={getCurrentPosition:(success,error)=>gps.push({success,error})};`);
 return run;
}
for(const city of ['boston','chicago']){
 test(city+': changing tentacle radius starts a new lookup and ignores old completion',async()=>{
  const run=game(city);
  run(`qtype='tentacles';pickStepDefs=QDEFS.tentacles.pickSteps;qparams={center:{lat:42,lng:-71},radius_miles:.5};var requests=[];resolveTentacleQuestionOptions=(category,center,radius)=>new Promise(resolve=>requests.push({radius,resolve}));var first=selectTentacleCat(TENTACLES_CATS[0]);setParam('radius_miles',2);`);
  assert.equal(run('requests.length'),2);assert.equal(run('requests[1].radius'),2);
  await run(`requests[1].resolve([{name:'new1',lat:42,lng:-71},{name:'new2',lat:42,lng:-70}]);Promise.resolve()`);
  await run(`requests[0].resolve([{name:'old1'},{name:'old2'}]);first`);
  assert.equal(run('qparams.tentacle_options[0].name'),'new1');assert.equal(run('qparams.center.lat'),42);assert.equal(run('qparams.radius_miles'),2);
 });
 test(city+': old Measure result cannot answer replacement Radar question',async()=>{
  const run=game(city);
  run(`_hiderQ={id:'measure',type:'measure',category:'A Park',category_label:'Park',center:{lat:1,lng:0},_seeker_measure:{dist:5}};var finish;resolveMeasureValue=()=>new Promise(r=>finish=r);var pending=hiderComputeAnswer({lat:2,lng:0});_hiderQ={id:'radar',type:'radar',center:{lat:1,lng:0},radius_miles:1};`);
  await run(`finish({dist:1,name:'old'});pending`);assert.equal(run('results.length'),0);
 });
 test(city+': newer location wins against delayed Measure result for same question',async()=>{
  const run=game(city);
  run(`_hiderQ={id:'measure',type:'measure',category_label:'Park',center:{lat:1,lng:0},_seeker_measure:{dist:5}};var finish;resolveMeasureValue=(q,p)=>p.lat===2?new Promise(r=>finish=r):Promise.resolve({dist:9,name:'new'});var pending=hiderComputeAnswer({lat:2,lng:0});`);
  await run(`hiderComputeAnswer({lat:3,lng:0})`);
  await run(`finish({dist:1,name:'old'});pending`);assert.equal(run('results.length'),1);assert.equal(run('results[0].answer'),'further');
 });
 for(const category of ['matching','nearest']){
  test(city+': '+category+' GPS lookup cannot overwrite a manual answer',async()=>{
   const run=game(city);
   run(`_hiderQ={id:'original',type:'${category}',category:'test',category_label:'Test',center:{lat:1,lng:0}};var finish;findMatchingCategory=()=>({resolve:()=>new Promise(r=>finish=r)});findNearestCategory=()=>({});resolveNearestValue=()=>new Promise(r=>finish=r);_hiderQ._seeker_match={val:'old'};_hiderQ._seeker_nearest={name:'old'};`);
   await run(category==='matching'?'hiderAutoMatchLookup()':'hiderAutoNearestLookup()');
   run(`var pending=gps[0].success({coords:{latitude:2,longitude:0}});hiderPickAnswer('No','manual');`);
   await run(`finish({val:'old',name:'old'});pending`);assert.equal(run('results.length'),1);assert.equal(run('results[0].answer'),'No');
  });
 }
 test(city+': cancel map pick prevents next click setting hider location and cancels GPS',()=>{
  const run=game(city);
  run(`_hiderQ={id:'radar',type:'radar',center:{lat:1,lng:0},radius_miles:1};var locations=0;hiderSetLocation=()=>locations++;handleYellowRegionTap=()=>false;dismissYellowRegionMenu=()=>{};hiderGPS();hiderTapMap();dismissBanner();onMapClick({latlng:{lat:2,lng:0}});gps[0].success({coords:{latitude:2,longitude:0,accuracy:1}});`);
  assert.equal(run('locations'),0);assert.equal(run('_hiderPickingLocation'),false);assert.equal(run("document.getElementById('hider-gps-btn').disabled"),false);
 });
 test(city+': reset invalidates pending question hydration',async()=>{
  const run=game(city);
  run(`cityCompatibilityError=()=>null;validateQuestionForCity=()=>{};normalizeLatLng=p=>p;document.getElementById('hider-json-in').value=JSON.stringify({type:'tentacles',id:'old',center:{lat:42,lng:-71},category:'Park'});var finish;resolveTentacleQuestionOptions=()=>new Promise(r=>finish=r);var pending=hiderLoadQuestion();hiderReset();`);
  await run(`finish([{name:'A',lat:42,lng:-71},{name:'B',lat:42,lng:-70}]);pending`);assert.equal(run('_hiderQ'),null);assert.equal(run("document.getElementById('hider-locate-state').style.display"),'none');
 });
}

for(const city of ['boston','chicago']){
 function seekerHarness(){
  const run=game(city);
  run(`var hydrations=[],saved=0,remembered=[],loaded=[];
    hydrateOutgoingQuestion=payload=>new Promise((resolve,reject)=>hydrations.push({payload,resolve,reject}));
    rememberOutgoingQuestion=q=>remembered.push(q.id);saveGame=()=>saved++;
    qtype='radar';qparams={center:{lat:42,lng:-71},radius_miles:1};
    var first=loadQuestionFromRaw('{"id":"old"}',q=>loaded.push(q.id));`);
  return run;
 }
 for(const outcome of ['resolve','reject']) test(city+': newer imported question wins against stale hydration '+outcome,async()=>{
  const run=seekerHarness();
  run(`var second=loadQuestionFromRaw('{"id":"new"}',q=>loaded.push(q.id));`);
  await run(`hydrations[1].resolve({id:'new'});second`);
  await run(outcome==='resolve' ? `hydrations[0].resolve({id:'old'});first` : `hydrations[0].reject(new Error('obsolete'));first`);
  assert.equal(run('loaded.join()'),'new');assert.equal(run('remembered.join()'),'new');assert.equal(run('saved'),1);
  assert.equal(run("notices.some(x=>x.includes('obsolete'))"),false);
 });
 for(const [action,code] of [
  ['repicking','invalidatePickedLocation()'],
  ['changing radius',"setParam('radius_miles',2)"],
  ['closing the loader','setLoadQuestionPanelOpen(false)'],
 ]) test(city+': '+action+' prevents pending imported question from mutating editor or persistence',async()=>{
  const run=seekerHarness();
  run(code);
  await run(`hydrations[0].resolve({id:'old'});first`);
  assert.equal(run('loaded.length'),0);assert.equal(run('remembered.length'),0);assert.equal(run('saved'),0);
 });
 for(const [action,code] of [
  ['repicking','invalidatePickedLocation()'],
  ['changing radius',"setParam('radius_miles',2)"],
  ['replacing the question',"currentBuiltQuestion={id:'replacement'}"],
 ]) test(city+': '+action+' cancels deferred JSON presentation',()=>{
  const run=game(city);
  run(`var timers=[],presented=0;setTimeout=fn=>timers.push(fn);rememberOutgoingQuestion=forgetOutgoingQuestion=saveGame=()=>{};
    renderSimulBtns=renderDirectApplyBtns=()=>presented++;
    qtype='radar';qparams={center:{lat:42,lng:-71},radius_miles:1};generateJSON();`);
  run(code);
  run('timers.forEach(fn=>fn())');
  assert.equal(run("document.getElementById('json-out').value"),'');assert.equal(run('presented'),0);
 });
 test(city+': current deferred JSON presentation remains available',()=>{
  const run=game(city);
  run(`var timers=[],presented=0;setTimeout=fn=>timers.push(fn);rememberOutgoingQuestion=forgetOutgoingQuestion=saveGame=()=>{};
    renderSimulBtns=renderDirectApplyBtns=()=>presented++;
    qtype='radar';qparams={center:{lat:42,lng:-71},radius_miles:1};generateJSON();timers.forEach(fn=>fn());`);
  assert.equal(run("JSON.parse(document.getElementById('json-out').value).radius_miles"),1);
  assert.equal(run('presented'),2);
 });
 test(city+': legacy effects cannot override definition-owned scopes and wire adapter remains compatible',()=>{
  const run=game(city);
  for(const [question,scope] of [
    [{type:'radar'},'location'],[{type:'matching',category:'city'},'location'],
    [{type:'matching',category:'line'},'station'],[{type:'custom_boundary'},'fixed'],[{type:'photo'},'none'],
  ]){
    for(const effect of ['hard','soft']){
      const normalized=run(`normalizeConstraintEntry(${JSON.stringify({...question,constraint_scope:'bogus',constraint_effect:effect,zone_effect:effect,constraint_policy:{default_effect:effect}})})`);
      assert.equal(normalized.constraint_scope,scope);
      for(const field of ['constraint_effect','zone_effect','constraint_policy']) assert.equal(field in normalized,false);
    }
  }
  const packet=run(`buildQuestionPacket({type:'matching',id:'legacy',category:'city',category_label:'City',center:{lat:42,lng:-71},constraint_effect:'hard'})`);
  assert.equal(packet.constraint_effect,'soft');assert.equal(packet.constraint_policy.default_effect,'soft');
  const imported=run(`normalizeConstraintEntry(${JSON.stringify(packet)})`);
  assert.equal(imported.constraint_scope,'location');assert.equal('constraint_effect' in imported,false);
  assert.equal(run("buildQuestionPacket({type:'matching',category:'line',center:{lat:42,lng:-71},constraint_effect:'soft'}).constraint_effect"),undefined);
 });
}
