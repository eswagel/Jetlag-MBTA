const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
function game(city){
 const nodes=new Map();const context=vm.createContext({console,URLSearchParams,window:{location:{search:'?city='+city}},localStorage:{getItem:()=>null},navigator:{},turf:{polygon:coordinates=>({type:'Feature',geometry:{type:'Polygon',coordinates}})},document:{getElementById:id=>{if(!nodes.has(id))nodes.set(id,{textContent:'',className:'',classList:{add(){}}});return nodes.get(id);}}});
 for(const file of ['00-cities.js','01-core.js','04-build.js','06-seeker.js'])vm.runInContext(fs.readFileSync('assets/js/app/'+file,'utf8'),context);
 vm.runInContext(`var events=[];var hardBefore=validZone;softZone={soft:true};stopRegionState={greenFeatures:[{green:true}],yellowFeatures:[{yellow:true}]};var stopBefore=stopRegionState;var softBefore=softZone;clearZonePreview=()=>events.push('clear');renderLog=()=>events.push('log');saveGame=()=>events.push('save');toast=()=>{};commitZoneState=()=>{events.push('commit');return true};recomputeZoneFromConstraints=()=>{events.push('recompute');return true};`,context);
 return {run:s=>vm.runInContext(s,context),nodes};
}
for(const city of ['boston','chicago']){
 test(city+': photo apply/delete preserve geometry and refresh log/save without rebuild',()=>{
 const g=game(city);assert.equal(g.run("QDEFS.photo.affectsZone"),false);
 assert.equal(g.run("applyConstraintIncrementally({type:'photo',prompt:'A Tree',answer:'sent'})"),true);
 assert.equal(g.run('constraints.length'),1);assert.equal(g.run('validZone===hardBefore && softZone===softBefore && stopRegionState===stopBefore'),true);
 assert.equal(g.run('events.join()'),'clear,log,save');g.run('events=[];deleteConstraintAt(0)');assert.equal(g.run('constraints.length'),0);assert.equal(g.run('events.join()'),'clear,log,save');
 });
 test(city+': spatial apply and undo retain geometry path while no-op preview clears stale overlays',()=>{
 const g=game(city);g.run("QDEFS.auditSpatial={applyToZone:z=>z};applyConstraintIncrementally({type:'auditSpatial'})");assert.equal(g.run('events.join()'),'commit');
 g.run("events=[];constraints=[{type:'auditSpatial'}];deleteConstraintAt(0)");assert.equal(g.run('events.join()'),'recompute');
 g.run("events=[];deriveStopRegionState=()=>{throw Error('unexpected geometry rebuild')};var preview=derivePreviewZoneState({type:'photo'});renderZonePreviewState(preview,'Photo sent')");
 assert.equal(g.run('preview.stopState===stopBefore && preview.hardZone===hardBefore'),true);assert.equal(g.run('events.join()'),'clear');assert.match(g.nodes.get('simul-hint').textContent,/map unchanged/);
 });
}
