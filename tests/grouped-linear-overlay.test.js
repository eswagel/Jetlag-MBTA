const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const turf=require('@turf/turf');
function engine(){
 const ctx=vm.createContext({console,turf,URLSearchParams,window:{location:{search:'?city=chicago'}},localStorage:{getItem:()=>null},document:{getElementById:()=>null},navigator:{}});
 for(const file of ['00-cities.js','01-core.js','02-map.js','04-build.js'])vm.runInContext(fs.readFileSync(path.join(__dirname,'../assets/js/app',file),'utf8'),ctx);
 return ctx;
}
const line=(name,coords)=>({type:'Feature',properties:{name},geometry:{type:'LineString',coordinates:coords}});
test('shared line display coalesces reversed and differently sampled geometry without changing source tracks',()=>{
 const c=engine(),data=[line('River service',[[-87,42],[-86.99,42]]),line('Valley service',[[-86.99,42],[-86.995,42],[-87,42]])];
 const before=JSON.stringify(data),corridors=c.prepareGroupedLinearCorridors(data);
 assert.equal(corridors.length,1);assert.deepEqual([...corridors[0].names],['River service','Valley service']);assert.equal(JSON.stringify(data),before);
});
test('twenty collocated route labels become one accessible route group',()=>{
 const c=engine(),candidates=Array.from({length:20},(_,i)=>({point:{x:250+i/10,y:150},names:['Route '+i],active:i===0,length:100}));
 const labels=c.layoutGroupedLineLabels(candidates,{x:800,y:600});
 assert.equal(labels.length,1);assert.equal(labels[0].names.length,20);assert.equal(labels[0].active,true);
});
test('layout labels remain within viewport and cannot overlap after dense candidate grouping',()=>{
 const c=engine(),candidates=Array.from({length:90},(_,i)=>({point:{x:20+(i%10)*75,y:20+Math.floor(i/10)*45},names:['Route '+i],length:i,active:false}));
 const labels=c.layoutGroupedLineLabels(candidates,{x:800,y:450});assert.ok(labels.length>1&&labels.length<=8);
 for(const a of labels){assert.ok(a.point.x>=a.width/2&&a.point.x+a.width/2<=800);assert.ok(a.point.y>=a.height/2&&a.point.y+a.height/2<=450);
  for(const b of labels){if(a===b)continue;assert.ok(Math.abs(a.point.x-b.point.x)>=a.width+10 || Math.abs(a.point.y-b.point.y)>=a.height+10);}}
});
test('Chicago route dataset produces unique display edges while preserving all route names',()=>{
 const c=engine(),data=JSON.parse(fs.readFileSync(path.join(__dirname,'../data/chicago/pois.json'))).amtrakLines;
 const corridors=c.prepareGroupedLinearCorridors(data),names=new Set(corridors.flatMap(x=>[...x.names]));
 assert.equal(names.size,new Set(data.map(x=>x.name||x.properties.name)).size);
 const edges=corridors.flatMap(x=>x.path.slice(1).map((point,i)=>[x.path[i].join(','),point.join(',')].sort().join('|')));
 assert.equal(edges.length,new Set(edges).size);assert.ok(corridors.some(x=>x.names.length>5));
});
test('removing an overlay detaches every view listener and removes both layers and disclosure',()=>{
 const c=engine(),calls=[];c.target={map:{off:(...args)=>calls.push(['off',...args])},redrawLabels:()=>{},tracks:{remove:()=>calls.push('tracks')},labels:{remove:()=>calls.push('labels')},legend:{remove:()=>calls.push('legend')}};
 vm.runInContext('GroupedLinearOverlay.prototype.remove.call(target)',c);
 assert.equal(calls[0][1],'zoomend moveend resize');assert.equal(calls[0][2],c.target.redrawLabels);assert.deepEqual(calls.slice(1),['tracks','labels','legend']);
});
