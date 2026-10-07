const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
function engine(city='chicago'){
 const ctx=vm.createContext({window:{location:{search:'?city='+city}},URLSearchParams});
 for(const file of ['00-cities.js','02-map.js'])vm.runInContext(fs.readFileSync(path.join(__dirname,'../assets/js/app',file),'utf8'),ctx);
 vm.runInContext('const GAME_LINES=ACTIVE_CITY.lines;',ctx);
 return ctx;
}
const route=(id,path)=>({id,shapePath:path});
const def=(id,physicalLineId=id)=>({id,physicalLineId,label:id,color:'#abc'});
test('branches merge across reversed geometry and unequal sampling',()=>{
 const c=engine(),lines=[route('G1',[[42,-87.7],[42,-87.69],[42.01,-87.69]]),route('G2',[[42.01,-87.68],[42,-87.69],[42,-87.695],[42,-87.7]])];
 const result=c.prepareTransitCorridors(lines,[def('G1','Green'),def('G2','Green')]);
 assert.ok(result.length>=3);assert.ok(result.every(r=>r.lanes.length===1));
 const edges=result.flatMap(r=>r.path.slice(1).map((point,i)=>[r.path[i].join(','),point.join(',')].sort().join('|')));
 assert.equal(new Set(edges).size,edges.length);
});
test('different lines sharing tracks become separate lanes',()=>{
 const c=engine(),path=[[42,-87.7],[42,-87.69]],result=c.prepareTransitCorridors([route('A',path),route('B',[...path].reverse())],[def('A'),def('B')]);
 assert.equal(result.length,1);assert.equal(result[0].lanes.length,2);
 const points=[{x:0,y:0},{x:100,y:0}],a=c.offsetTransitPath(points,-2.5),b=c.offsetTransitPath(points,2.5);
 assert.equal(Math.abs(a[0].y-b[0].y),5);assert.equal(Math.abs(a[1].y-b[1].y),5);
});
test('Purple is one question identity, solid local trunk and dashed express extension',()=>{
 const c=engine();assert.equal(vm.runInContext('GAME_LINES.filter(l=>l.physicalLineId==="Purple").length',c),1);
 const r=c.prepareTransitCorridors([route('Purple',[[42.07,-87.69],[42.02,-87.67]]),route('Purple-Express',[[42.07,-87.69],[42.02,-87.67],[41.9,-87.65]])]);
 assert.equal(r.filter(x=>x.lanes[0].dashArray).length,1);assert.equal(r.filter(x=>!x.lanes[0].dashArray).length,1);
 assert.ok(r.every(x=>x.lanes.length===1&&x.lanes[0].physicalLineId==='Purple'));
});
test('real city routes coalesce Green branches and Purple dashes stop at Howard',()=>{
 for(const city of ['chicago','boston']){
  const c=engine(city),data=JSON.parse(fs.readFileSync(path.join(__dirname,city==='chicago'?'../data/chicago/transit.json':'../data/mbta-data.json'),'utf8'));
  const corridors=c.prepareTransitCorridors(data.lines);
  assert.ok(corridors.every(c=>new Set(c.lanes.map(l=>l.physicalLineId)).size===c.lanes.length));
  assert.ok(corridors.some(c=>c.lanes.some(l=>l.physicalLineId==='Green')));
  if(city==='chicago'){
   const dashed=corridors.filter(c=>c.lanes.some(l=>l.physicalLineId==='Purple'&&l.dashArray));
   assert.ok(dashed.length);assert.ok(dashed.every(c=>Math.max(...c.path.map(p=>p[0]))<42.020));
   assert.ok(corridors.some(c=>c.lanes.length>=4));
  }
 }
});
test('pixel offsets retain lane spacing at every zoom and bounded corners',()=>{
 const c=engine();for(const scale of [1,2,8,32]){
  const p=[{x:0,y:0},{x:100*scale,y:0},{x:100*scale,y:100*scale}],a=c.offsetTransitPath(p,-2.5),b=c.offsetTransitPath(p,2.5);
  assert.equal(Math.abs(a[0].y-b[0].y),5);assert.equal(Math.abs(a[2].x-b[2].x),5);
  assert.ok(a.every((p,i)=>Math.hypot(p.x-[0,100*scale,100*scale][i],p.y-[0,0,100*scale][i])<5));
 }
});

test('conditional variants and shared tracks are generic at other latitudes',()=>{
 const c=engine();
 const definitions=[{...def('violet','violet'),displaySources:[{id:'weekday'},{id:'evening',dashArray:'3 2',serviceVariant:'evening'}]},def('gold')];
 const corridors=c.prepareTransitCorridors([
  route('weekday',[[10,20],[10,20.02]]),route('evening',[[10,20],[10,20.02],[10,20.04]]),
  route('gold',[[10.00003,20],[10.00003,20.02]])
 ],definitions);
 assert.ok(corridors.some(x=>x.lanes.length===2 && x.lanes.every(l=>!l.dashArray)));
 assert.ok(corridors.some(x=>x.lanes.some(l=>l.dashArray==='3 2' && l.serviceVariant==='evening')));
});
