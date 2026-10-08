const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
function game(city){
 const elements = new Map();
 const c = vm.createContext({console, URLSearchParams, window:{location:{search:'?city='+city}}, localStorage:{getItem:()=>null}, navigator:{}, document:{getElementById(id){if(!elements.has(id)) elements.set(id,{value:'',style:{},classList:{add(){},remove(){}}});return elements.get(id);},querySelectorAll:()=>[]}, turf:{polygon:coordinates=>({type:'Feature',geometry:{type:'Polygon',coordinates}})}});
 for(const f of ['00-cities.js','01-core.js','03-setup.js','04-build.js','05-hider.js']) vm.runInContext(fs.readFileSync('assets/js/app/'+f,'utf8'),c);
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
