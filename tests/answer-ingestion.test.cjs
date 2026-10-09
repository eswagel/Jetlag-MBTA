const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
function game(city){
 const c=vm.createContext({console,URLSearchParams,URL,setTimeout,clearTimeout,turf:require('@turf/turf'),window:{location:{search:'?city='+city}},localStorage:{getItem:()=>null},document:{getElementById:()=>null},navigator:{}});
 for(const f of ['00-cities.js','linear-distance-filter.js','01-core.js','04-build.js','05-hider.js','06-seeker.js','04-city-questions.js'])vm.runInContext(fs.readFileSync('assets/js/app/'+f,'utf8'),c);
 const run=s=>vm.runInContext(s,c);
 run(`var messages=[],applied=[],successes=0;toast=m=>messages.push(m);applyAnswerObject=q=>applied.push(q);var center={lat:42.36,lng:-71.06};var boundary=turf.bboxPolygon([-71.07,42.35,-71.05,42.37]);normalizeMatchingBoundaryForCenter=b=>b;resolveCategory('matching','city').resolve=async()=>({val:'Fixture City',boundary});var packet={id:'other-device',type:'matching',category:'city',center,answer:'Yes',...cityMetadata()};`);
 return run;
}
for(const city of ['boston','chicago']){
 test(city+': compact answer reconstructs missing geographic context before application',async()=>{
  const run=game(city);await run(`applyAnswerFromRaw(JSON.stringify(packet),()=>successes++)`);
  assert.equal(run('applied.length'),1);assert.equal(run('applied[0].seeker_val'),'Fixture City');assert.equal(run('applied[0].boundary_geojson.geometry.type'),'Polygon');assert.equal(run('applied[0].answer'),'Yes');
 });
 test(city+': failed or unavailable answer geography is not logged as success',async()=>{
  const run=game(city);run(`resolveCategory('matching','city').resolve=async()=>{throw Error('offline')}`);
  await run(`applyAnswerFromRaw(JSON.stringify(packet),()=>successes++)`);assert.equal(run('applied.length'),0);assert.match(run('messages.at(-1)'),/offline/);
  run(`packet.seeker_val='City';packet.boundary_geojson=null`);await run(`applyAnswerFromRaw(JSON.stringify(packet),()=>successes++)`);assert.equal(run('applied.length'),0);assert.match(run('messages.at(-1)'),/offline/);
 });
 test(city+': answer hydration cannot overwrite subsequent game changes',async()=>{
  const run=game(city);run(`var finish;resolveCategory('matching','city').resolve=()=>new Promise(r=>finish=r);var pending=applyAnswerFromRaw(JSON.stringify(packet),()=>successes++);`);
  await run(`Promise.resolve()`);run(`constraints.push({type:'_veto'});finish({val:'City',boundary});`);await run('pending');assert.equal(run('applied.length'),0);
 });
 test(city+': tentacles rejects unknown and out-of-reach answers before application',async()=>{
  const run=game(city);run(`packet={...packet,type:'tentacles',category:'park',radius_miles:1,options:[{id:'a',name:'A',...center},{id:'b',name:'B',lat:42.361,lng:-71.06},{id:'far',name:'Far',lat:43,lng:-71}],answer:'garbage'};`);
  for(const answer of ['garbage','far']){run(`packet.answer=${JSON.stringify(answer)}`);await run(`applyAnswerFromRaw(JSON.stringify(packet),()=>successes++)`);assert.equal(run('applied.length'),0);assert.match(run('messages.at(-1)'),/invalid answer/);}
  for(const answer of ['a','no']){run(`packet.answer=${JSON.stringify(answer)}`);await run(`applyAnswerFromRaw(JSON.stringify(packet),()=>successes++)`);}
  assert.equal(run('applied.length'),2);
 });
}
