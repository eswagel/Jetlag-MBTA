// ══════════════════════════════════════════════════════
//  MAP INIT
// ══════════════════════════════════════════════════════
function initMap(){
  map=L.map('map',{center:CENTER,zoom:12,minZoom:1,maxZoom:19,zoomSnap:1,wheelPxPerZoomLevel:20,wheelDebounceTime:20,zoomControl:false,attributionControl:false});
  L.control.attribution({position:'topleft'}).addTo(map);

  // One light basemap for every city. Positron preserves Boston's original
  // visual hierarchy; OpenFreeMap supplies OSM vector tiles without an API key.
  L.maplibreGL({
    style:'https://tiles.openfreemap.org/styles/positron',
    attribution:'<a href="https://openfreemap.org/">OpenFreeMap</a> &copy; <a href="https://www.openmaptiles.org/">OpenMapTiles</a> Data from <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    pane:'tilePane',
    interactive:false,
  }).addTo(map);

  L.control.zoom({position:'topleft'}).addTo(map);

  // ── Administrative boundary layers (below zone) ──
  countyLayer = L.geoJSON(null,{interactive:false,style:{
    color:'#7799bb', weight:3, fill:false, opacity:0.75, dashArray:'8 5'
  }}).addTo(map);
  townLayer = L.geoJSON(null,{interactive:false,style:{
    color:'#9aaabb', weight:1.5, fill:false, opacity:0.55, dashArray:'4 4'
  }}).addTo(map);
  // Highlight layer — drawn on top of zone layers when a boundary question is active
  boundaryHighlightLayer = L.geoJSON(null,{interactive:false,style:{
    color:'#f0a030', weight:3, fill:false, opacity:0.9
  }});

  // Zone layers behind T lines
  maskLayer  =L.geoJSON(null,{interactive:false,style:{color:'transparent',weight:0,fillColor:'#cc1010',fillOpacity:0.42}}).addTo(map);
  softLayer  =L.geoJSON(null,{interactive:false,style:{color:'#f0a030',weight:2,fillColor:'#f0a030',fillOpacity:0.20,dashArray:'6 4'}}).addTo(map);
  borderLayer=L.geoJSON(null,{interactive:false,style:{color:'#18b050',weight:3,fillColor:'#18b050',fillOpacity:0.10,dashArray:'7 4'}}).addTo(map);

  radiusLayer = L.layerGroup().addTo(map);

  previewLayer=L.geoJSON(null,{interactive:false,style:{color:'#f0a030',weight:1.5,fillColor:'#f0a030',fillOpacity:0.08,dashArray:'4 3'}}).addTo(map);
  tentaclePreviewLayer=L.geoJSON(null,{interactive:false,style:(feature)=>({
    color: feature?.properties?.strokeColor || feature?.properties?.color || '#20c8b0',
    weight: feature?.properties?.weight ?? 2,
    opacity: feature?.properties?.opacity ?? 0.9,
    fillColor: feature?.properties?.fillColor || feature?.properties?.color || '#20c8b0',
    fillOpacity: feature?.properties?.fillOpacity ?? 0.18,
    dashArray: feature?.properties?.dashArray || null,
  })}).addTo(map);
  simulLayer=L.geoJSON(null,{interactive:false,style:{color:'#20c8b0',weight:2,fillColor:'#20c8b0',fillOpacity:0.22}}).addTo(map);
  simulMaskLayer=L.geoJSON(null,{interactive:false,style:{color:'transparent',weight:0,fillColor:'#e84040',fillOpacity:0.18}}).addTo(map);

  renderZone();
  map.on('click',onMapClick);
  loadLandmassData(); // async background load of precomputed landmasses
  loadElevationData();
  loadMBTAData();
  loadAdminBoundaries(); // async background fetch
}

// ══════════════════════════════════════════════════════
//  GOOGLE POLYLINE DECODER
// ══════════════════════════════════════════════════════
function decodePolyline(str){
  let idx=0,lat=0,lng=0,out=[];
  while(idx<str.length){
    let b,shift=0,res=0;
    do{b=str.charCodeAt(idx++)-63;res|=(b&0x1f)<<shift;shift+=5;}while(b>=0x20);
    lat+=((res&1)?~(res>>1):(res>>1));
    shift=0;res=0;
    do{b=str.charCodeAt(idx++)-63;res|=(b&0x1f)<<shift;shift+=5;}while(b>=0x20);
    lng+=((res&1)?~(res>>1):(res>>1));
    out.push([lat/1e5,lng/1e5]);
  }
  return out;
}

// ══════════════════════════════════════════════════════
//  MBTA API — load shapes + stops per game line
// ══════════════════════════════════════════════════════
async function loadMBTADataLegacy(){
  if(ACTIVE_CITY.id !== 'boston') return loadMBTAData();
  const BASE = 'https://api-v3.mbta.com';
  const legStatus = document.getElementById('leg-status');
  const allStops = {};
  let loaded = 0;

  const staticData = preloadedData.mbta || await fetchOptionalJSON(DATA_FILES.mbta, 'MBTA snapshot');
  if(staticData?.lines?.length){
    preloadedData.mbta = staticData;
    hydrateMBTAFromStatic(staticData, legStatus);
    await loadLandmassData();
    return;
  }

  // Fetch commuter rail stop IDs — use parent_station to match subway stop IDs
  try{
    const crResp = await fetch(`${BASE}/stops?filter[route_type]=2&fields[stop]=name,latitude,longitude&page[size]=500&include=parent_station`);
    const crData = await crResp.json();
    const seen = new Set();
    (crData.data||[]).forEach(s => {
      commuterRailStops.add(s.id);
      const parentId = s.relationships?.parent_station?.data?.id;
      if(parentId) commuterRailStops.add(parentId);
      const name = s.attributes?.name;
      const lat  = s.attributes?.latitude;
      const lng  = s.attributes?.longitude;
      if(name && lat && lng && !seen.has(name)){
        seen.add(name);
        commuterRailStopsList.push({id: s.id, name, lat, lng});
      }
    });
    console.log(`Loaded ${commuterRailStops.size} CR IDs, ${commuterRailStopsList.length} named CR stops`);
  }catch(e){ console.warn('CR stops fetch failed:', e); }

  // Known Braintree-only stop IDs (south of JFK, not on Ashmont branch)
  // Everything else on the Red route is trunk (both) or Ashmont-only.
  // Ashmont-only: place-shmnl, place-fldcr, place-smmnl, place-asmnl
  // Braintree-only: place-nqncy, place-wlsta, place-qnctr, place-qamnl, place-brntn
  const ASHMONT_ONLY = new Set(['place-shmnl','place-fldcr','place-smmnl','place-asmnl']);
  const BRAINTREE_ONLY = new Set(['place-nqncy','place-wlsta','place-qnctr','place-qamnl','place-brntn']);
  // All other Red stops are trunk → both branches

  // ── Load all lines in parallel ──
  await Promise.all(GAME_LINES.map(async line => {
    try {
      // ── Shape ──
      let shapePath = null;
      const shapeResp = await fetch(`${BASE}/shapes?filter[route]=${line.routeId}&fields[shape]=polyline`);
      const shapeData = await shapeResp.json();

      if (line.branchKeyword) {
        const keyword = line.branchKeyword.toLowerCase();
        const allDecoded = (shapeData.data||[])
          .map(s => ({ id: s.id, coords: decodePolyline(s.attributes.polyline) }))
          .filter(s => s.coords.length > 1);

        console.log(`Red shapes for ${line.id}:`, allDecoded.map(s=>s.id));

        // Try 1: shape ID contains branch keyword (e.g. "canonical-Red-Ashmont-0")
        let match = allDecoded.find(s => s.id.toLowerCase().includes(keyword));

        // Try 2: find by terminal latitude
        // Ashmont terminus: ~42.284°N   Braintree terminus: ~42.207°N
        if(!match){
          const termLat = line.branchKeyword === 'Ashmont' ? 42.284 : 42.207;
          match = allDecoded.reduce((best, s) => {
            const endLat = s.coords[s.coords.length-1][0];
            const score = -Math.abs(endLat - termLat);
            return (!best || score > best.score) ? {...s, score} : best;
          }, null);
          if(match) console.log(`Red ${line.branchKeyword}: using terminal-lat fallback, picked`, match.id);
        }

        shapePath = match ? match.coords : null;
      } else {
        const sorted = (shapeData.data||[])
          .map(s => decodePolyline(s.attributes.polyline))
          .filter(c => c.length > 1)
          .sort((a,b) => b.length - a.length);
        shapePath = sorted[0] || null;
      }

      if (shapePath) {
        L.polyline(shapePath, {color:'#1a1a1a', weight:line.weight+3, opacity:0.4, lineJoin:'round', lineCap:'round'}).addTo(map);
        L.polyline(shapePath, {
          color: line.color,
          weight: line.weight,
          opacity: 1,
          dashArray: line.dashArray || null,
          lineJoin:'round', lineCap:'round'
        }).bindTooltip(line.label, {sticky:true}).addTo(map);
      }

      // ── Stops ──
      // For both Red branches, fetch all Red stops once and assign by branch membership
      const stopResp = await fetch(
        `${BASE}/stops?filter[route]=${line.routeId}&fields[stop]=name,latitude,longitude`
      );
      const stopData = await stopResp.json();
      (stopData.data||[]).forEach(s => {
        const {name, latitude:lat, longitude:lng} = s.attributes;
        if (!lat || !lng) return;
        const sid = s.id;

        // Determine which branch(es) this Red stop belongs to
        let assignTo = [line.id];
        if (line.branchKeyword === 'Ashmont') {
          if (BRAINTREE_ONLY.has(sid)) return; // skip — not on Ashmont branch
        } else if (line.branchKeyword === 'Braintree') {
          if (ASHMONT_ONLY.has(sid)) return;   // skip — not on Braintree branch
        }

        if (!allStops[sid]) allStops[sid] = {name, lat, lng, lines:[], color:line.color};
        if (!allStops[sid].lines.includes(line.id)) allStops[sid].lines.push(line.id);
        if (!stopLineMap[sid]) stopLineMap[sid] = {name, lat, lng, lines:new Set()};
        stopLineMap[sid].lines.add(line.id);
      });

      loaded++;
      if (legStatus) legStatus.textContent = `⟳ ${loaded}/${GAME_LINES.length} loaded`;
    } catch(e) {
      console.warn('MBTA load error for', line.id, e);
      loaded++;
    }
  }));
  drawStopMarkers(allStops);
  finalizeMBTALoad(legStatus);
  await loadLandmassData();
}

async function fetchMBTAJson(url){
  const res = await fetch(url, {headers:{Accept:'application/json'}});
  if(!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.json();
}

async function fetchLiveMBTASnapshot(legStatus){
  if(ACTIVE_CITY.id !== 'boston') throw new Error('MBTA service is only available in Boston');
  const BASE = 'https://api-v3.mbta.com';
  const ASHMONT_ONLY = new Set(['place-shmnl','place-fldcr','place-smmnl','place-asmnl']);
  const BRAINTREE_ONLY = new Set(['place-nqncy','place-wlsta','place-qnctr','place-qamnl','place-brntn']);
  let loaded = 0;

  const linePromises = GAME_LINES.map(async line => {
    const [shapeData, stopData] = await Promise.all([
      fetchMBTAJson(`${BASE}/shapes?filter[route]=${line.routeId}&fields[shape]=polyline`),
      fetchMBTAJson(`${BASE}/stops?filter[route]=${line.routeId}&fields[stop]=name,latitude,longitude`),
    ]);

    let shapePath = [];
    if(line.branchKeyword){
      const keyword = line.branchKeyword.toLowerCase();
      const allDecoded = (shapeData.data || [])
        .map(s => ({id: s.id, coords: decodePolyline(s.attributes.polyline)}))
        .filter(s => s.coords.length > 1);
      let match = allDecoded.find(s => s.id.toLowerCase().includes(keyword));
      if(!match){
        const termLat = line.branchKeyword === 'Ashmont' ? 42.284 : 42.207;
        match = allDecoded.reduce((best, s) => {
          const endLat = s.coords[s.coords.length - 1][0];
          const score = -Math.abs(endLat - termLat);
          return (!best || score > best.score) ? {...s, score} : best;
        }, null);
      }
      shapePath = match ? match.coords : [];
    } else {
      const sorted = (shapeData.data || [])
        .map(s => decodePolyline(s.attributes.polyline))
        .filter(coords => coords.length > 1)
        .sort((a, b) => b.length - a.length);
      shapePath = sorted[0] || [];
    }

    const stops = (stopData.data || [])
      .map(s => ({
        id: s.id,
        name: s.attributes?.name,
        lat: s.attributes?.latitude,
        lng: s.attributes?.longitude,
      }))
      .filter(stop => Number.isFinite(stop.lat) && Number.isFinite(stop.lng))
      .filter(stop => {
        if(line.branchKeyword === 'Ashmont') return !BRAINTREE_ONLY.has(stop.id);
        if(line.branchKeyword === 'Braintree') return !ASHMONT_ONLY.has(stop.id);
        return true;
      });

    loaded++;
    if(legStatus) legStatus.textContent = `⟳ ${loaded}/${GAME_LINES.length} loaded`;

    return {
      id: line.id,
      label: line.label,
      color: line.color,
      weight: line.weight,
      routeId: line.routeId,
      branchKeyword: line.branchKeyword || null,
      shapePath,
      stops,
    };
  });

  const commuterRailPromise = fetchMBTAJson(`${BASE}/stops?filter[route_type]=2&fields[stop]=name,latitude,longitude&page[size]=500&include=parent_station`)
    .then(data => {
      const seen = new Set();
      return (data.data || [])
        .map(stop => ({
          id: stop.id,
          parentId: stop.relationships?.parent_station?.data?.id || null,
          name: stop.attributes?.name,
          lat: stop.attributes?.latitude,
          lng: stop.attributes?.longitude,
        }))
        .filter(stop =>
          stop.name &&
          Number.isFinite(stop.lat) &&
          Number.isFinite(stop.lng) &&
          stop.lat >= T_BBOX.minLat &&
          stop.lat <= T_BBOX.maxLat &&
          stop.lng >= T_BBOX.minLng &&
          stop.lng <= T_BBOX.maxLng &&
          (!seen.has(stop.name) && seen.add(stop.name))
        );
    });

  const [lines, commuterRail] = await Promise.all([
    Promise.all(linePromises),
    commuterRailPromise,
  ]);

  return {
    generatedAt: new Date().toISOString(),
    bbox: {south: T_BBOX.minLat, north: T_BBOX.maxLat, west: T_BBOX.minLng, east: T_BBOX.maxLng},
    lines,
    commuterRail,
  };
}

async function loadMBTAData(){
  const legStatus = document.getElementById('leg-status');
  if(ACTIVE_CITY.id !== 'boston'){
    const data = await fetchOptionalJSON(DATA_FILES.mbta, `${ACTIVE_CITY.networkLabel} snapshot`);
    if(data?.lines?.some(line => line.stops?.length) && !cityCompatibilityError(data)){
      preloadedData.mbta = data;
      hydrateMBTAFromStatic(data, legStatus);
      await loadLandmassData();
    }else{
      if(legStatus) legStatus.textContent = `⚠ ${ACTIVE_CITY.networkLabel} data unavailable`;
      const status = document.getElementById('setup-status-text');
      if(status) status.textContent = `${ACTIVE_CITY.name} station data is unavailable or incompatible. Reload after the dataset is installed.`;
      document.getElementById('btn-start').disabled = true;
      mbdataReady = false;
    }
    return;
  }

  try{
    const liveData = await fetchLiveMBTASnapshot(legStatus);
    if(liveData?.lines?.length){
      preloadedData.mbta = liveData;
      hydrateMBTAFromStatic(liveData, legStatus);
      await loadLandmassData();
      return;
    }
  }catch(e){
    console.warn('Live MBTA load failed, falling back to local snapshot:', e);
  }

  const staticData = preloadedData.mbta || await fetchOptionalJSON(DATA_FILES.mbta, 'MBTA snapshot');
  if(staticData?.lines?.length){
    preloadedData.mbta = staticData;
    hydrateMBTAFromStatic(staticData, legStatus);
    await loadLandmassData();
    return;
  }

  console.warn('MBTA live load and local snapshot load both failed');
  if(legStatus) legStatus.textContent = '⚠ 0 stops — check MBTA data';
  const txt = document.getElementById('setup-status-text');
  if(txt) txt.textContent = '⚠ MBTA data failed to load';
}

function transitSourceMetadata(line, definitions=GAME_LINES){
  const definition=definitions.find(item=>item.id===line.id || item.displaySources?.some(source=>source.id===line.id));
  return {
    definition:definition || {id:line.id,physicalLineId:line.physicalLineId || line.id,label:line.label || line.id,color:line.color || '#888',weight:line.weight || 4},
    source:definition?.displaySources?.find(source=>source.id===line.id) || line,
  };
}

// Build a small geographic graph before projecting to pixels. Shared branch
// geometry contributes one physical line per edge; different lines get lanes.
// Snap tolerance absorbs GTFS sampling/parallel-track differences, not stations.
function prepareTransitCorridors(lines, definitions=GAME_LINES){
  const latitudes=lines.flatMap(line=>(line.shapePath || line.path || []).map(point=>point[0])).filter(Number.isFinite);
  const referenceLatitude=latitudes.length ? latitudes.reduce((sum,lat)=>sum+lat,0)/latitudes.length : 0;
  const scaleX = 111320 * Math.max(0.01,Math.cos(referenceLatitude * Math.PI / 180)), scaleY = 111320;
  const tolerance = 18, cellSize = 40;
  const nodes = [], buckets = new Map(), segments = [];
  const cell = (x,y) => `${Math.floor(x/cellSize)},${Math.floor(y/cellSize)}`;
  const nearby = (minX,minY,maxX,maxY) => {
    const found = [];
    for(let x=Math.floor(minX/cellSize); x<=Math.floor(maxX/cellSize); x++){
      for(let y=Math.floor(minY/cellSize); y<=Math.floor(maxY/cellSize); y++){
        found.push(...(buckets.get(`${x},${y}`) || []));
      }
    }
    return found;
  };
  function nodeFor(latlng){
    const x=latlng[1]*scaleX, y=latlng[0]*scaleY;
    let best=null, distance=tolerance;
    for(const node of nearby(x-tolerance,y-tolerance,x+tolerance,y+tolerance)){
      const d=Math.hypot(x-node.x,y-node.y);
      if(d<distance){best=node;distance=d;}
    }
    if(best) return best;
    const node={id:nodes.length,x,y,latlng:[latlng[0],latlng[1]]};
    nodes.push(node);const key=cell(x,y);
    if(!buckets.has(key)) buckets.set(key,[]);
    buckets.get(key).push(node);return node;
  }
  const metas = new Map();
  for(const line of lines){
    const {definition,source}=transitSourceMetadata(line,definitions);
    const physicalLineId=definition.physicalLineId || definition.id;
    const meta={...definition,physicalLineId,label:definition.displayLabel || definition.label || definition.id};
    metas.set(physicalLineId,meta);
    const path=(line.shapePath || line.path || []).filter(p=>p?.length>=2 && p.every(Number.isFinite)).map(nodeFor);
    for(let i=1;i<path.length;i++){
      if(path[i-1].id !== path[i].id) segments.push({a:path[i-1],b:path[i],physicalLineId,dashArray:source.dashArray || definition.dashArray || null,serviceVariant:source.serviceVariant || null});
    }
  }
  const edges=new Map();
  for(const segment of segments){
    const {a,b}=segment,dx=b.x-a.x,dy=b.y-a.y,length2=dx*dx+dy*dy;
    const interior=nearby(Math.min(a.x,b.x)-tolerance,Math.min(a.y,b.y)-tolerance,Math.max(a.x,b.x)+tolerance,Math.max(a.y,b.y)+tolerance)
      .filter(n=>n!==a && n!==b)
      .map(n=>({n,t:((n.x-a.x)*dx+(n.y-a.y)*dy)/length2}))
      .filter(({n,t})=>t>0.001 && t<0.999 && Math.hypot(n.x-a.x-t*dx,n.y-a.y-t*dy)<tolerance)
      .sort((u,v)=>u.t-v.t);
    const points=[a,...interior.map(p=>p.n),b];
    for(let i=1;i<points.length;i++){
      const u=points[i-1],v=points[i];if(u.id===v.id)continue;
      const key=[u.id,v.id].sort((a,b)=>a-b).join(':');
      if(!edges.has(key))edges.set(key,{a:u,b:v,lines:new Map()});
      const edge=edges.get(key),previous=edge.lines.get(segment.physicalLineId);
      // The regular segment wins where a conditional variant uses the same track.
      const dashArray=previous ? (previous.dashArray && segment.dashArray) : segment.dashArray;
      edge.lines.set(segment.physicalLineId,{...metas.get(segment.physicalLineId),dashArray,serviceVariant:dashArray ? segment.serviceVariant : null});
    }
  }
  // Join edges with the same lane roster to keep dashed patterns and corners continuous.
  const groups=new Map();
  for(const edge of edges.values()){
    const lanes=[...edge.lines.values()].sort((a,b)=>a.physicalLineId.localeCompare(b.physicalLineId));
    const key=lanes.map(l=>`${l.physicalLineId}:${l.dashArray || 'solid'}`).join('|');
    if(!groups.has(key))groups.set(key,{lanes,edges:[]});
    groups.get(key).edges.push(edge);
  }
  const corridors=[];
  for(const group of groups.values()){
    const adjacency=new Map();
    group.edges.forEach((edge,index)=>{
      edge.index=index;
      for(const node of [edge.a,edge.b]){
        if(!adjacency.has(node.id))adjacency.set(node.id,[]);
        adjacency.get(node.id).push(edge);
      }
    });
    const used=new Set();
    function walk(first,start){
      const path=[start.latlng];let edge=first,node=start;
      while(edge && !used.has(edge.index)){
        used.add(edge.index);node=edge.a.id===node.id ? edge.b : edge.a;path.push(node.latlng);
        const neighbors=adjacency.get(node.id);
        edge=neighbors.length===2 ? neighbors.find(e=>!used.has(e.index)) : null;
      }
      corridors.push({path,lanes:group.lanes});
    }
    for(const edge of group.edges){
      if(used.has(edge.index))continue;
      if(adjacency.get(edge.a.id).length!==2)walk(edge,edge.a);
      else if(adjacency.get(edge.b.id).length!==2)walk(edge,edge.b);
    }
    for(const edge of group.edges)if(!used.has(edge.index))walk(edge,edge.a);
  }
  return corridors;
}

function offsetTransitPath(points, offset){
  if(!offset || points.length<2)return points.map(p=>({x:p.x,y:p.y}));
  const normals=[];
  for(let i=1;i<points.length;i++){
    const dx=points[i].x-points[i-1].x,dy=points[i].y-points[i-1].y,length=Math.hypot(dx,dy)||1;
    normals.push({x:-dy/length,y:dx/length});
  }
  return points.map((point,i)=>{
    const a=normals[Math.max(0,i-1)],b=normals[Math.min(normals.length-1,i)];
    const x=a.x+b.x,y=a.y+b.y,denominator=x*b.x+y*b.y;
    const factor=Math.abs(denominator)>0.1 ? Math.min(2,2/denominator) : 1;
    return {x:point.x+x*0.5*offset*factor,y:point.y+y*0.5*offset*factor};
  });
}

let transitRouteLayer=null, transitRouteRedraw=null;
function drawTransitRoutes(lines){
  if(transitRouteLayer)transitRouteLayer.remove();
  if(transitRouteRedraw)map.off('zoomend',transitRouteRedraw);
  transitRouteLayer=L.layerGroup().addTo(map);
  const corridors=prepareTransitCorridors(lines);
  transitRouteRedraw=()=>{
    transitRouteLayer.clearLayers();
    const zoom=map.getZoom(),spacing=5;
    for(const corridor of corridors){
      const projected=corridor.path.map(latlng=>map.project(latlng,zoom));
      corridor.lanes.forEach((line,index)=>{
        const offset=(index-(corridor.lanes.length-1)/2)*spacing;
        const path=offsetTransitPath(projected,offset).map(point=>map.unproject(L.point(point.x,point.y),zoom));
        L.polyline(path,{color:line.color,weight:4,opacity:1,lineCap:'round',lineJoin:'round',dashArray:line.dashArray})
          .bindTooltip(line.label+(line.serviceVariant ? ` · ${line.serviceVariant} service segment` : ''),{sticky:true}).addTo(transitRouteLayer);
      });
    }
  };
  transitRouteRedraw();
  map.on('zoomend',transitRouteRedraw);
}

function hydrateMBTAFromStatic(data, legStatus){
  Object.keys(stopLineMap).forEach(k => delete stopLineMap[k]);
  commuterRailStops.clear();
  commuterRailStopsList.length = 0;

  const lines = data.lines || [];
  drawTransitRoutes(lines);
  const allStops = {};
  lines.forEach(line => {
    const {definition:meta,source}=transitSourceMetadata(line);
    // Conditional variants add station membership only through a service snapshot.
    if(source.includeStationMembership === false) return;
    (line.stops || []).forEach(stop => {
      if(!Number.isFinite(stop.lat) || !Number.isFinite(stop.lng)) return;
      const sid = stop.id;
      if(!allStops[sid]) allStops[sid] = {name:stop.name, lat:stop.lat, lng:stop.lng, lines:[], color:meta.color};
      if(!allStops[sid].lines.includes(meta.id)) allStops[sid].lines.push(meta.id);
      if(!stopLineMap[sid]) stopLineMap[sid] = {id:sid, name:stop.name, lat:stop.lat, lng:stop.lng, lines:new Set()};
      stopLineMap[sid].lines.add(meta.id);
    });
  });

  const seenCR = new Set();
  (data.commuterRail || []).forEach(stop => {
    commuterRailStops.add(stop.id);
    if(stop.parentId) commuterRailStops.add(stop.parentId);
    const identity = stop.id || `${stop.agency || ''}:${stop.lat},${stop.lng}`;
    if(stop.name && Number.isFinite(stop.lat) && Number.isFinite(stop.lng) && !seenCR.has(identity)){
      seenCR.add(identity);
      commuterRailStopsList.push({id: stop.id, agency:stop.agency, name: stop.name, lat: stop.lat, lng: stop.lng});
    }
  });

  drawStopMarkers(allStops);
  finalizeMBTALoad(legStatus);
}

function drawStopMarkers(allStops){
  const lineInfo = {};
  GAME_LINES.forEach(gl => { lineInfo[gl.id] = {label: gl.label, color: gl.color}; });

  function badgeLabel(lineId){
    const label = (lineInfo[lineId]||{}).label || lineId;
    return label
      .replace('Line · ','· ')
      .replace(' Line','')
      .replace('Red · Ashmont','Red A')
      .replace('Red · Braintree','Red B');
  }

  Object.entries(allStops).forEach(([sid, {name, lat, lng, lines, color}]) => {
    const isCR = commuterRailStops.has(sid) &&
      lat >= T_BBOX.minLat && lat <= T_BBOX.maxLat &&
      lng >= T_BBOX.minLng && lng <= T_BBOX.maxLng;

    const GREEN_COLOR = '#00843D';
    const uniqueColors = [...new Set(lines.map(lid => {
      const c = (lineInfo[lid]||{}).color || color;
      return (lid.startsWith('Green') || lid === 'Mattapan') ? (lid === 'Mattapan' ? '#800000' : GREEN_COLOR) : c;
    }))];

    const popupHTML = `<div class="stop-popup">
      <div class="stop-popup-name">${name}</div>
      <div class="stop-popup-lines">${[...new Set(lines)].map(lid=>{
        const col=(lineInfo[lid]||{}).color||color;
        return `<span class="stop-line-badge" style="background:${col}"><span class="stop-line-dot"></span>${badgeLabel(lid)}</span>`;
      }).join('')}${isCR?`<span class="stop-line-badge" style="background:#7a4f9a"><span class="stop-line-dot"></span>CR</span>`:''}</div>
    </div>`;

    const icon = makeStopIcon(uniqueColors);
    L.marker([lat, lng], {icon, zIndexOffset: isCR ? 200 : (uniqueColors.length > 1 ? 100 : 0)})
      .bindPopup(popupHTML, {offset:[0,-2], maxWidth:240})
      .on('click', function(){
        if(_pickingHiderStation){
          setHiderStation({id:sid, name, lat, lng, lines:[...new Set(lines)]});
          return;
        }
        const activeStep = pickStep >= 0 && pickStep < pickStepDefs.length ? pickStepDefs[pickStep] : null;
        if(activeStep?.key === 'center' && typeof applyPickedPoint === 'function'){
          applyPickedPoint(lat, lng);
          return;
        }
        this.openPopup();
      })
      .addTo(map);
  });
}

function finalizeMBTALoad(legStatus){
  const stopCount = Object.keys(stopLineMap).length;
  console.log(`Loaded ${stopCount} stops into stopLineMap`);
  if (legStatus) {
    legStatus.textContent = stopCount > 0 ? `✓ ${stopCount} stops` : `⚠ 0 stops — check console`;
    setTimeout(() => { legStatus.style.display='none'; }, 3500);
  }

  mbdataReady = stopCount > 0;
  if(mbdataReady && ACTIVE_CITY.id === 'chicago'){
    // Frame CTA stops, not the larger envelope used to collect reference data.
    const bounds = L.latLngBounds(Object.values(stopLineMap).map(stop => [stop.lat, stop.lng]));
    const desktop = window.innerWidth > 768;
    map.fitBounds(bounds, {paddingTopLeft:[32,56], paddingBottomRight:[desktop ? 392 : 32,48], animate:false});
  }
  const dot = document.getElementById('setup-dot');
  const txt = document.getElementById('setup-status-text');
  const btn = document.getElementById('btn-start');
  if (dot) dot.classList.toggle('ready', mbdataReady);
  if (txt) txt.textContent = stopCount > 0
    ? `${stopCount} stops loaded — ready!`
    : `⚠ Stops failed to load — check network`;
  if (btn) btn.disabled = !mbdataReady;
  if(typeof onGameSessionReady === 'function') onGameSessionReady();
}

async function loadLandmassData(){
  if(_landmassCache.ready) return _landmassCache.pieces;
  if(_landmassCache.loading) return _landmassCache.loading;

  // Multiple startup paths ask for landmasses before the first fetch completes.
  // Reuse the in-flight load so the browser only fetches/parses this once.
  _landmassCache.loading = (async () => {
    const data = preloadedData.landmasses || await fetchOptionalJSON(DATA_FILES.landmasses, 'landmasses');
    if(!data) return null;
    preloadedData.landmasses = data;
    _landmassCache.pieces = (data.pieces || []).map(piece => ({
      type:'Feature',
      properties:{id: piece.id, name: piece.name},
      geometry: deepClone(piece.geometry),
    })).filter(piece => piece.geometry?.type === 'Polygon' || piece.geometry?.type === 'MultiPolygon');
    _landmassCache.stopIndex = {...(data.stops || {})};
    _landmassCache.ready = _landmassCache.pieces.length > 0;
    if(_landmassCache.ready && typeof renderBuildBody === 'function') renderBuildBody();
    return _landmassCache.pieces;
  })();

  try{
    return await _landmassCache.loading;
  }finally{
    _landmassCache.loading = null;
  }
}
