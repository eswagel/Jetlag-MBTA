/* Bounded conservative distance filtering. Exact distances stay in the question engine.
 * Cells whose answer cannot be certified are retained for BOTH answers, never guessed.
 * UMD supports the browser's Turf 6 and offline tests with Turf 7.
 */
(function(root, factory){
  if(typeof module === 'object' && module.exports) module.exports = factory;
  else root.LinearDistanceFilter = factory(root.turf);
})(typeof globalThis === 'object' ? globalThis : this, function(turf){
  'use strict';
  const VERSION = 'adaptive-linear-v1';
  const EARTH_MILES = 6371008.8 / 1609.344;
  const RAD = Math.PI / 180;
  const DEFAULTS = Object.freeze({maxCells:24000, maxDepth:14, resolutionMeters:20, slackMeters:2});
  const indexes = new WeakMap();
  const results = new Map(); // Small LRU: never retain every answer's geometry.
  let nextIndex = 0;

  function distance(a,b){
    const dlat=(b[1]-a[1])*RAD, dlng=(b[0]-a[0])*RAD;
    const h=Math.sin(dlat/2)**2 + Math.cos(a[1]*RAD)*Math.cos(b[1]*RAD)*Math.sin(dlng/2)**2;
    return 2*EARTH_MILES*Math.asin(Math.sqrt(Math.min(1,Math.max(0,h))));
  }
  function cap(bounds){
    const [w,s,e,n]=bounds, center=[(w+e)/2,(s+n)/2];
    // On these local (<10 degree) domains, farthest rectangle points are corners.
    // A spherical cap with radius <90 degrees is geodesically convex, so it also
    // contains every shortest great-circle segment between its contained endpoints.
    return {center,radius:Math.max(...[[w,s],[w,n],[e,s],[e,n]].map(p=>distance(center,p)))};
  }
  function validBounds(bounds){
    return bounds.length===4 && bounds.every(Number.isFinite) && bounds[0]<=bounds[2] && bounds[1]<=bounds[3] &&
      bounds[2]-bounds[0]<=10 && bounds[3]-bounds[1]<=10 && bounds[1]>-85 && bounds[3]<85;
  }
  function indexFeatures(features){
    const key=features;
    if(!Array.isArray(features) || !features.length || !features[0]?.geometry) throw new Error('Line geometry is unavailable');
    if(indexes.has(key)) return indexes.get(key);
    const segments=[];
    for(const feature of features){
      const g=feature.geometry;
      if(g?.type === 'Point'){
        const p=g.coordinates;
        if(!Array.isArray(p)||!Number.isFinite(p[0])||!Number.isFinite(p[1])) throw new Error('Invalid point coordinate');
        if(segments.length>=250000) throw new Error('Point source exceeds the bounded filter size');
        segments.push({a:p,b:p,point:true});
        continue;
      }
      if(!g || !['LineString','MultiLineString'].includes(g.type)) throw new Error('Expected point or line geometry');
      const lines=g.type==='LineString'?[g.coordinates]:g.coordinates;
      for(const points of lines){
        for(const p of points) if(!Array.isArray(p)||!Number.isFinite(p[0])||!Number.isFinite(p[1])) throw new Error('Invalid line coordinate');
        for(let i=1;i<points.length;i++){
          if(segments.length>=250000) throw new Error('Line source exceeds the bounded filter size; update its index before enabling it');
          if(points[i-1][0]!==points[i][0] || points[i-1][1]!==points[i][1]) segments.push({a:points[i-1],b:points[i]});
        }
      }
    }
    if(!segments.length) throw new Error('Line geometry is empty');
    function node(items){
      const bounds=[Infinity,Infinity,-Infinity,-Infinity];
      for(const item of items) for(const p of [item.a,item.b]){
        bounds[0]=Math.min(bounds[0],p[0]); bounds[1]=Math.min(bounds[1],p[1]);
        bounds[2]=Math.max(bounds[2],p[0]); bounds[3]=Math.max(bounds[3],p[1]);
      }
      if(!validBounds(bounds)) throw new Error('Adaptive line filtering needs a local geographic extent without an antimeridian crossing');
      const out=cap(bounds);
      if(items.length<=8){
        out.points=items.filter(item=>item.point).map(item=>item.a);
        const lines=items.filter(item=>!item.point);
        if(lines.length) out.feature=turf.multiLineString(lines.map(item=>[item.a,item.b]));
      }
      else{
        const axis=(bounds[2]-bounds[0])*.75>bounds[3]-bounds[1]?0:1;
        items.sort((a,b)=>(a.a[axis]+a.b[axis])-(b.a[axis]+b.b[axis]));
        const middle=items.length>>1;
        out.left=node(items.slice(0,middle)); out.right=node(items.slice(middle));
      }
      return out;
    }
    const tree=node(segments);
    const index={id:++nextIndex,segments:segments.length,nearest(point){
      let best=Infinity;
      const p=turf.point(point);
      function visit(branch){
        if(distance(branch.center,point)-branch.radius>best+1e-9) return;
        if(branch.points){
          for(const pointCoordinate of branch.points) best=Math.min(best,distance(pointCoordinate,point));
          if(!branch.feature) return;
          const d=turf.nearestPointOnLine(branch.feature,p,{units:'miles'}).properties.dist;
          if(!Number.isFinite(d)) throw new Error('Cannot calculate line distance');
          best=Math.min(best,d); return;
        }
        const left=distance(branch.left.center,point)-branch.left.radius;
        const right=distance(branch.right.center,point)-branch.right.radius;
        if(left<right){ visit(branch.left); visit(branch.right); }
        else{ visit(branch.right); visit(branch.left); }
      }
      visit(tree); return best;
    }};
    indexes.set(key,index);
    return index;
  }
  function domains(zone){
    if(!zone) throw new Error('A filtering extent is required');
    const polygons=turf.flatten(zone).features;
    const unique=new Map();
    for(const polygon of polygons){
      if(polygon.geometry.type!=='Polygon') throw new Error('Expected a polygon filtering extent');
      const bounds=turf.bbox(polygon);
      if(!validBounds(bounds)) throw new Error('Invalid or oversized filtering extent');
      if(bounds[0]===bounds[2]||bounds[1]===bounds[3]) continue;
      unique.set(JSON.stringify(bounds),bounds);
    }
    if(!unique.size || unique.size>4096) throw new Error('Filtering extent has too many disconnected regions');
    return [...unique.values()].sort((a,b)=>a[0]-b[0]||a[1]-b[1]||a[2]-b[2]||a[3]-b[3]);
  }
  function dissolve(cells){
    if(!cells.length) return null;
    const collection=turf.dissolve(turf.featureCollection(cells.map(b=>turf.bboxPolygon(b))));
    const polygons=collection.features.flatMap(f=>f.geometry.type==='Polygon'?[f.geometry.coordinates]:f.geometry.coordinates);
    return polygons.length?turf.multiPolygon(polygons):null;
  }
  function build(features,thresholdMiles,zone,options={}){
    if(!Number.isFinite(thresholdMiles)||thresholdMiles<0) throw new Error('Invalid distance threshold');
    const config={...DEFAULTS,...options};
    if(config.maxCells<4||config.maxCells>48000||!Number.isInteger(config.maxCells)||
       config.maxDepth<1||config.maxDepth>18||!Number.isInteger(config.maxDepth)||
       config.resolutionMeters<1||config.slackMeters<2||
       ![config.resolutionMeters,config.slackMeters].every(Number.isFinite)) throw new Error('Invalid filter resource limits');
    const index=indexFeatures(features), boxes=domains(zone);
    const key=JSON.stringify([index.id,thresholdMiles,boxes,config]);
    if(results.has(key)){const result=results.get(key);results.delete(key);results.set(key,result);return result;}
    // Every cell must get a distance test: reserve the complete breadth-first queue,
    // rather than exhaust the budget on one corner and abandon the rest of the map.
    const queue=boxes.map(bounds=>({bounds,depth:0}));
    if(queue.length>config.maxCells) throw new Error('Too many filtering regions for the configured cell budget');
    const closer=[],further=[];
    let uncertain=0,maxUncertainDiameterMeters=0;
    const slack=config.slackMeters/1609.344;
    for(let cursor=0;cursor<queue.length;cursor++){
      const cell=queue[cursor], {center,radius}=cap(cell.bounds), nearest=index.nearest(center);
      // Distance-to-a-set is 1-Lipschitz. Triangle bounds certify whole cells;
      // source/query numerical error gets an additional explicit two-meter margin.
      if(nearest+radius+slack<thresholdMiles){closer.push(cell.bounds);continue;}
      if(nearest-radius-slack>thresholdMiles){further.push(cell.bounds);continue;}
      if(cell.depth>=config.maxDepth || radius*2*1609.344<=config.resolutionMeters || queue.length+4>config.maxCells){
        uncertain++; maxUncertainDiameterMeters=Math.max(maxUncertainDiameterMeters,radius*2*1609.344);continue;
      }
      const [w,s,e,n]=cell.bounds,[x,y]=center,depth=cell.depth+1;
      queue.push(...[[w,s,x,y],[x,s,e,y],[w,y,x,n],[x,y,e,n]].map(bounds=>({bounds,depth})));
    }
    const result={version:VERSION,
      // Exclude only cells certified to contradict the answer. Unresolved cells
      // belong to neither exclusion geometry, and therefore survive both answers.
      excludeForCloser:dissolve(further), excludeForFurther:dissolve(closer),
      stats:{cells:queue.length,uncertainCells:uncertain,maxUncertainDiameterMeters,segments:index.segments,...config}};
    results.set(key,result); while(results.size>4) results.delete(results.keys().next().value);
    return result;
  }
  return {VERSION,DEFAULTS,build,indexFeatures};
});
