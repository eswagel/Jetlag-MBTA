const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
function game(city){
 const c=vm.createContext({console,URLSearchParams,window:{location:{search:'?city='+city}},localStorage:{getItem:()=>null},navigator:{},document:{getElementById:()=>({style:{},classList:{add(){}}})},turf:{polygon:coordinates=>({type:'Feature',geometry:{type:'Polygon',coordinates}})}});
 for(const f of ['00-cities.js','01-core.js','04-build.js'])vm.runInContext(fs.readFileSync('assets/js/app/'+f,'utf8'),c);
 const run=s=>vm.runInContext(s,c);
 run(`qtype='matching';qparams={center:{lat:41.8,lng:-87.6},matching_cat:'neighbourhood',matching_seeker_val:'Hyde Park',matching_boundary:{old:true},_matching_boundary_simplified:{old:true}};pickStepDefs=QDEFS.matching.pickSteps;clearMarkers=()=>{};previewLayer={clearLayers(){}};clearZonePreview=()=>{};showBanner=()=>{};renderBuildBody=()=>{};highlightBoundary=()=>{};tryGenerate=()=>{};toast=()=>{};isChicagoGame=()=>true;`);
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
