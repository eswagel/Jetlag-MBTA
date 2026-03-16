// ══════════════════════════════════════════════════════
//  MAP INIT
// ══════════════════════════════════════════════════════
function initMap(){
  map=L.map('map',{center:CENTER,zoom:12,zoomControl:false});

  L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',{
    attribution:'© OpenStreetMap contributors © CARTO',
    subdomains:'abcd', maxZoom:19
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
  borderLayer=L.geoJSON(null,{interactive:false,style:{color:'#18b050',weight:3,fillColor:'#18b050',fillOpacity:0.10,dashArray:'7 4'}}).addTo(map);

  radiusLayer = L.layerGroup().addTo(map);

  previewLayer=L.geoJSON(null,{interactive:false,style:{color:'#f0a030',weight:1.5,fillColor:'#f0a030',fillOpacity:0.08,dashArray:'4 3'}}).addTo(map);
  simulLayer=L.geoJSON(null,{interactive:false,style:{color:'#20c8b0',weight:2,fillColor:'#20c8b0',fillOpacity:0.22}}).addTo(map);

  renderZone();
  map.on('click',onMapClick);
  loadLandmassData(); // async background load of precomputed landmasses
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
async function loadMBTAData(){
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
          dashArray: line.id === 'Mattapan' ? '8 5' : null,
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

function hydrateMBTAFromStatic(data, legStatus){
  Object.keys(stopLineMap).forEach(k => delete stopLineMap[k]);
  commuterRailStops.clear();
  commuterRailStopsList.length = 0;

  const lines = data.lines || [];
  const allStops = {};
  lines.forEach(line => {
    const shapePath = line.shapePath || line.path || [];
    const meta = GAME_LINES.find(gl => gl.id === line.id) || {
      id: line.id,
      label: line.label || line.id,
      color: line.color || '#888',
      weight: line.weight || 4,
    };
    if(shapePath.length > 1){
      L.polyline(shapePath, {color:'#1a1a1a', weight:meta.weight+3, opacity:0.4, lineJoin:'round', lineCap:'round'}).addTo(map);
      L.polyline(shapePath, {
        color: meta.color,
        weight: meta.weight,
        opacity: 1,
        dashArray: meta.id === 'Mattapan' ? '8 5' : null,
        lineJoin:'round',
        lineCap:'round',
      }).bindTooltip(meta.label, {sticky:true}).addTo(map);
    }
    (line.stops || []).forEach(stop => {
      if(!Number.isFinite(stop.lat) || !Number.isFinite(stop.lng)) return;
      const sid = stop.id;
      if(!allStops[sid]) allStops[sid] = {name:stop.name, lat:stop.lat, lng:stop.lng, lines:[], color:meta.color};
      if(!allStops[sid].lines.includes(meta.id)) allStops[sid].lines.push(meta.id);
      if(!stopLineMap[sid]) stopLineMap[sid] = {name:stop.name, lat:stop.lat, lng:stop.lng, lines:new Set()};
      stopLineMap[sid].lines.add(meta.id);
    });
  });

  const seenCR = new Set();
  (data.commuterRail || []).forEach(stop => {
    commuterRailStops.add(stop.id);
    if(stop.parentId) commuterRailStops.add(stop.parentId);
    if(stop.name && Number.isFinite(stop.lat) && Number.isFinite(stop.lng) && !seenCR.has(stop.name)){
      seenCR.add(stop.name);
      commuterRailStopsList.push({id: stop.id, name: stop.name, lat: stop.lat, lng: stop.lng});
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

    const icon = makeStopIcon(uniqueColors, isCR);
    L.marker([lat, lng], {icon, zIndexOffset: isCR ? 200 : (uniqueColors.length > 1 ? 100 : 0)})
      .bindPopup(popupHTML, {offset:[0,-2], maxWidth:240})
      .on('click', function(){
        if(_pickingHiderStation){
          setHiderStation({name, lat, lng, lines:[...new Set(lines)]});
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

  mbdataReady = true;
  const dot = document.getElementById('setup-dot');
  const txt = document.getElementById('setup-status-text');
  const btn = document.getElementById('btn-start');
  if (dot) dot.classList.add('ready');
  if (txt) txt.textContent = stopCount > 0
    ? `${stopCount} stops loaded — ready!`
    : `⚠ Stops failed to load — check network`;
  if (btn) btn.disabled = false;
}

async function loadLandmassData(){
  if(_landmassCache.ready) return;
  const data = preloadedData.landmasses || await fetchOptionalJSON(DATA_FILES.landmasses, 'landmasses');
  if(!data) return;
  preloadedData.landmasses = data;
  _landmassCache.pieces = (data.pieces || []).map(piece => ({
    type:'Feature',
    properties:{id: piece.id, name: piece.name},
    geometry: deepClone(piece.geometry),
  })).filter(piece => piece.geometry?.type === 'Polygon' || piece.geometry?.type === 'MultiPolygon');
  _landmassCache.stopIndex = {...(data.stops || {})};
  _landmassCache.ready = _landmassCache.pieces.length > 0;
}
