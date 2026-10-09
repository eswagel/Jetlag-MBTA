const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
function context(){const c=vm.createContext({console,URLSearchParams,window:{location:{search:''}}});vm.runInContext(fs.readFileSync('assets/js/app/00-cities.js','utf8'),c);vm.runInContext(fs.readFileSync('assets/js/app/04-build.js','utf8'),c);return c;}
test('dense POI markers are separated on screen while retaining nearest and full source',()=>{
 const c=context();
 c.items=Array.from({length:3230},(_,i)=>({lat:0,lng:0,name:'Park'+i}));
 const result=vm.runInContext('layoutMeasurePointMarkers(items,(_p)=>({x:100,y:100}),{x:1000,y:700})',c);
 assert.equal(result.length,1);assert.equal(result[0].nearest,true);assert.equal(c.items.length,3230);
});
test('viewport movement reveals distant points beyond former100-pin cap',()=>{
 const c=context();c.items=Array.from({length:300},(_,i)=>({lat:0,lng:i,name:'Park'+i}));
 const result=vm.runInContext('layoutMeasurePointMarkers(items,p=>({x:(p.lng-220)*30,y:100}),{x:1000,y:700})',c);
 assert(result.some(x=>x.item.name==='Park250'));assert(result.every(x=>x.point.x>=0&&x.point.x<=1000));
 for(let i=1;i<result.length;i++)assert(result[i].point.x-result[i-1].point.x>=24);
});
test('point overlay releases all map subscriptions and marker layers',()=>{
 const c=context();let released=false,removed=false;
 c.target={map:{off:(events,callback)=>{assert.equal(events,'zoomend moveend resize');assert.equal(callback,c.target.redraw);released=true;}},redraw:()=>{},layer:{remove:()=>{removed=true;}}};
 vm.runInContext('MeasurePointOverlay.prototype.remove.call(target)',c);assert(released&&removed);
});
