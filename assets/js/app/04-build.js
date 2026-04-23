// ── Safe onclick dispatch — avoids quote escaping in HTML attributes ──
const _clicks = [];
function _c(fn){ _clicks.push(fn); return `_dispatch(${_clicks.length-1})`; }
function _dispatch(i){ _clicks[i](); }
function _clearClicks(){ _clicks.length=0; }

// ── Category data ──
// ── Matching categories — "Are we in the same ___?" ──
// resolve(latLng) returns { val: string, boundary: GeoJSON polygon | null }
const MATCHING_CATS = [
  {
    icon:'🚇', label:'T Line', cat:'line',
    resolve: async (_c, opts={}) => {
      const lineId = opts.lineId || null;
      const line = GAME_LINES.find(gl => gl.id === lineId);
      if(!line) return {val:null, boundary:null, line_id:null};
      return {
        val: line.label,
        boundary: buildLineMatchingBoundary(line.id, opts.hideRadiusMiles),
        line_id: line.id,
      };
    }
  },
  {
    icon:'🏝️', label:'Landmass', cat:'landmass',
    resolve: async (c) => {
      await loadLandmassData();
      const boundary = await resolveSeekersLandmass(c);
      const val = boundary?.properties?.name || null;
      return { val, boundary: boundary || null };
    }
  },
  {
    icon:'🏛️', label:'County', cat:'county',
    resolve: async (c) => {
      await loadBoundaryData();
      const local = resolveBoundaryFromPreloaded('county', c);
      if(local) return local;
      const rev = await fetch(`https://nominatim.openstreetmap.org/reverse?lat=${c.lat}&lon=${c.lng}&format=json&addressdetails=1`,{headers:{'Accept-Language':'en-US'}});
      const d = await rev.json();
      const val = d.address?.county || d.address?.state_district || null;
      if(!val) return { val:null, boundary:null };
      const boundary = await fetchNominatimBoundary(val + ' Massachusetts', 'boundary', 6);
      return { val, boundary };
    }
  },
  {
    icon:'🏙️', label:'City / Town', cat:'city',
    resolve: async (c) => {
      await loadBoundaryData();
      const local = resolveBoundaryFromPreloaded('city', c);
      if(local) return local;
      const rev = await fetch(`https://nominatim.openstreetmap.org/reverse?lat=${c.lat}&lon=${c.lng}&format=json&addressdetails=1`,{headers:{'Accept-Language':'en-US'}});
      const d = await rev.json();
      const val = d.address?.city || d.address?.town || d.address?.village || null;
      if(!val) return { val:null, boundary:null };
      const boundary = await fetchNominatimBoundary(val + ' Massachusetts', 'boundary', 8);
      return { val, boundary };
    }
  },
  {
    icon:'🏘️', label:'Neighborhood', cat:'neighborhood',
    resolve: async (c) => {
      await loadBoundaryData();
      const local = resolveBoundaryFromPreloaded('neighborhood', c);
      if(local) return local;
      const rev = await fetch(`https://nominatim.openstreetmap.org/reverse?lat=${c.lat}&lon=${c.lng}&format=json&addressdetails=1&zoom=15`,{headers:{'Accept-Language':'en-US'}});
      const d = await rev.json();
      const val = d.address?.suburb || d.address?.neighbourhood || d.address?.quarter || null;
      if(!val) return { val:null, boundary:null };
      const boundary = await fetchNominatimBoundary(val + ' Boston Massachusetts', 'boundary', 10);
      return { val, boundary };
    }
  },
  {
    icon:'📮', label:'ZIP Code', cat:'postcode',
    resolve: async (c) => {
      await loadBoundaryData();
      const local = resolveBoundaryFromPreloaded('postcode', c);
      if(local) return local;
      const rev = await fetch(`https://nominatim.openstreetmap.org/reverse?lat=${c.lat}&lon=${c.lng}&format=json&addressdetails=1`,{headers:{'Accept-Language':'en-US'}});
      const d = await rev.json();
      const val = d.address?.postcode || null;
      if(!val) return { val:null, boundary:null };
      const boundary = await fetchNominatimBoundary(val + ' Massachusetts', 'postcode', null);
      return { val, boundary };
    }
  },
];

const PHOTO_PROMPTS = [
  {icon:'TREE', text:'A Tree'},
  {icon:'SKY', text:'The Sky'},
  {icon:'SELF', text:'You (Selfie)'},
  {icon:'ROAD', text:'Widest Street'},
  {icon:'VIEW', text:'Tallest Structure in Your Sightline'},
  {icon:'BLDG', text:'Any Building Visible from Station'},
];

// ── Nearest categories — "Is the nearest ___ to me the same as to you?" ──
const NEAREST_CATS = [
  { icon:'🌳', label:'Park',             instances: async()=>{ await loadPoiData(); return getNamedPoiCollection('Park'); }, overpass:(c,r)=>`nwr["leisure"="park"]["name"](around:${r},${c.lat},${c.lng});` },
  { icon:'⛳', label:'Golf Course',      instances: async()=>{ await loadPoiData(); return getNamedPoiCollection('Golf Course'); }, overpass:(c,r)=>`nwr["leisure"="golf_course"](around:${r},${c.lat},${c.lng});` },
  { icon:'📚', label:'Library',          instances: async()=>{ await loadPoiData(); return getNamedPoiCollection('Library'); }, overpass:(c,r)=>`nwr["amenity"="library"](around:${r},${c.lat},${c.lng});` },
  { icon:'🏥', label:'Hospital',         instances: async()=>{ await loadPoiData(); return getNamedPoiCollection('Hospital'); }, overpass:(c,r)=>`nwr["amenity"="hospital"](around:${r},${c.lat},${c.lng});` },
  { icon:'🏛️', label:'Museum',          instances: async()=>{ await loadPoiData(); return getNamedPoiCollection('Museum'); }, overpass:(c,r)=>`nwr["tourism"="museum"](around:${r},${c.lat},${c.lng});` },
  { icon:'🎬', label:'Movie Theater',   instances: async()=>{ await loadPoiData(); return getNamedPoiCollection('Movie Theater'); }, overpass:(c,r)=>`nwr["amenity"="cinema"](around:${r},${c.lat},${c.lng});` },
  { icon:'🦒', label:'Zoo / Aquarium',  instances: async()=>{ await loadPoiData(); return getNamedPoiCollection('Zoo / Aquarium'); }, overpass:(c,r)=>`nwr["tourism"~"^(zoo|aquarium)$"](around:${r},${c.lat},${c.lng});` },
  { icon:'🏳️', label:'Foreign Consulate', instances: async()=>{ await loadPoiData(); return getNamedPoiCollection('Foreign Consulate'); }, overpass:(c,r)=>`nwr["office"~"diplomatic|consulate"](around:${r},${c.lat},${c.lng});nwr["amenity"="embassy"](around:${r},${c.lat},${c.lng});` },
];
// osm_class: 'boundary', 'postcode', or null (any)
// admin_level: OSM admin level (6=county, 8=municipality, 10=neighborhood) or null
async function fetchNominatimBoundary(query, featureClass, adminLevel){
  try{
    let url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=5&polygon_geojson=1&countrycodes=us`;
    const res = await fetch(url, {headers:{'Accept-Language':'en-US'}});
    const items = await res.json();
    if(!items.length) return null;
    // Find best match: prefer items with a polygon and matching class/admin_level
    const scored = items.map(item=>{
      let score = 0;
      if(item.geojson && (item.geojson.type==='Polygon'||item.geojson.type==='MultiPolygon')) score += 10;
      if(item.class === featureClass || item.type === featureClass) score += 5;
      if(adminLevel && item.extratags?.admin_level == adminLevel) score += 3;
      return {item, score};
    }).sort((a,b)=>b.score-a.score);
    const best = scored[0].item;
    if(!best.geojson || (best.geojson.type!=='Polygon' && best.geojson.type!=='MultiPolygon')) return null;
    // Wrap in a GeoJSON Feature
    return {type:'Feature', properties:{name:best.display_name}, geometry:best.geojson};
  } catch(e){
    console.warn('Boundary fetch failed:', e);
    return null;
  }
}

const _landmassCache = {
  ready: false,
  loading: null,
  pieces: [],           // array of Turf polygon Features
  stopIndex: {},        // stopId → piece index
};

function findContainingLandmass(latLng){
  if(!_landmassCache.ready) return null;
  const pt = turf.point([latLng.lng, latLng.lat]);
  for(const piece of _landmassCache.pieces){
    try{
      if(turf.booleanPointInPolygon(pt, piece)) return piece;
    }catch(e){}
  }
  return null;
}

function findNearestStopLandmass(latLng){
  if(!_landmassCache.ready) return null;
  const stops=Object.entries(stopLineMap);
  if(!stops.length) return null;
  let nearestSid=null, nearestDist=Infinity;
  for(const [sid,s] of stops){
    const d=turfDist(latLng,s);
    if(d<nearestDist){nearestDist=d;nearestSid=sid;}
  }
  if(!nearestSid) return null;
  const idx=_landmassCache.stopIndex[nearestSid];
  if(idx===undefined) return null;
  return _landmassCache.pieces[idx] || null;
}

// Return the landmass polygon for a given lat/lng.
// Prefer direct point-in-polygon against the preloaded regions; use nearest stop
// only as a fallback for tiny gaps introduced by manual drawing/simplification.
function landmassForPoint(latLng){
  const direct = findContainingLandmass(latLng);
  if(direct) return direct;
  const fallback = findNearestStopLandmass(latLng);
  if(fallback) return fallback;
  return null;
}

function stopHasGameLine(stop, lineId){
  if(!stop || !lineId) return false;
  if(stop.lines instanceof Set) return stop.lines.has(lineId);
  if(Array.isArray(stop.lines)) return stop.lines.includes(lineId);
  return false;
}

function buildLineMatchingBoundary(lineId, radiusMiles=hideRadiusMi){
  const stops = Object.values(stopLineMap).filter(stop => stopHasGameLine(stop, lineId));
  if(!stops.length) return null;
  let union = makeCircle(stops[0], radiusMiles, 'miles');
  for(let i = 1; i < stops.length; i++){
    try{
      union = turf.union(union, makeCircle(stops[i], radiusMiles, 'miles')) || union;
    }catch(e){}
  }
  return safeIsect(INIT_POLY, union) || union;
}

// Old per-question async resolver — now just a fast lookup
async function resolveSeekersLandmass(center){
  return landmassForPoint(center);
}

function renderBuildBody(){
  _clearClicks();
  const el = document.getElementById('build-body');
  if(!qtype){ el.innerHTML='<p class="empty" style="margin-top:8px">Choose a question type above to get started.</p>'; return; }
  let h = '';

  // Pick steps
  if(pickStepDefs.length > 0){
    h += '<div class="sec" style="margin-top:8px">Steps</div><div class="steps">';
    pickStepDefs.forEach((s,i)=>{
      const val=qparams[s.key], isDone=!!val, isCur=i===pickStep;
      h += `<div class="step-item ${isDone?'done-row':isCur?'active-row':''}">
        <div class="step-dot ${isDone?'done':isCur?'next':''}"></div>
        <div style="flex:1;min-width:0">
          <div>${isDone?'✓ '+s.key.replace(/_/g,' ').toUpperCase():s.label}</div>
          ${isDone?`<div class="step-val">📍 ${val.lat.toFixed(4)}, ${val.lng.toFixed(4)}</div>`:''}
          ${isCur?`<div id="gps-btn-${i}" class="step-gps-btn" onclick="useMyLocation('${s.key}',${i})">📡 Use My Location</div>`:''}
        </div></div>`;
    });
    h += '</div>';
    if(pickStep >= pickStepDefs.length)
      h += `<button class="btn btn-ghost" style="margin-bottom:8px;margin-top:4px" onclick="restartPick()">↺ Re-pick Points</button>`;
  }

  // Type-specific params
  if(qtype==='radar')      h += renderRadarParams();
  else if(qtype==='thermo')h += renderThermoParams();
  else if(qtype==='measure')h += renderMeasureParams();
  else if(qtype==='tentacles')h += renderTentaclesParams();
  else if(qtype==='matching')h += renderMatchingParams();
  else if(qtype==='photo') h += renderPhotoParams();
  else if(qtype==='custom_boundary') h += renderCustomBoundaryParams();

  el.innerHTML = h;
  if(typeof scheduleSaveGame === 'function') scheduleSaveGame();
}

function renderBoundaryBody(){
  const el = document.getElementById('boundary-body');
  if(!el) return;
  el.innerHTML = renderCustomBoundaryParams();
  if(typeof scheduleSaveGame === 'function') scheduleSaveGame();
}

function renderRadarParams(){
  const presets=[
    {r:0.25,l:'¼ mi'},
    {r:0.5,l:'½ mi'},
    {r:1,l:'1 mi'},
    {r:3,l:'3 mi'},
    {r:5,l:'5 mi'},
    {r:10,l:'10 mi'},
    {r:25,l:'25 mi'},
  ];
  const isCustom = qparams.radius_miles && !presets.find(p=>p.r===qparams.radius_miles);
  let h='<div class="sec">Radar Radius</div><div class="axrow" style="flex-wrap:wrap;gap:5px">';
  presets.forEach(p=>{
    h+=`<div class="axbtn ${qparams.radius_miles===p.r?'on':''}" onclick="${_c(()=>{setParam('radius_miles',p.r);setParam('_customR',false);updatePreview();tryGenerate();renderBuildBody();})}">${p.l}</div>`;
  });
  h+=`<div class="axbtn ${isCustom||qparams._customR?'on':''}" onclick="${_c(()=>{setParam('_customR',true);renderBuildBody();})}">Custom</div></div>`;
  if(isCustom||qparams._customR)
    h+=`<div class="param"><div class="plabel">Miles</div>
    <input type="number" min="0.1" step="0.1" value="${qparams.radius_miles||0.5}" style="width:80px"
    oninput="const v=+this.value;if(v>0){setParam('radius_miles',v);updatePreview();tryGenerate();}"></div>`;
  return h;
}

function renderThermoParams(){
  const presets=[{r:0.5,l:'1/2 mi'},{r:3,l:'3 mi'},{r:10,l:'10 mi'}];
  let h='<div class="sec">Travel Distance</div><div class="axrow" style="flex-wrap:wrap;gap:5px">';
  presets.forEach(p=>{
    h+=`<div class="axbtn ${qparams.travel_miles===p.r?'on':''}" onclick="${_c(()=>selectThermoDistance(p.r))}">${p.l}</div>`;
  });
  h+='</div>';
  if(!qparams.center){
    h+='<p class="empty" style="margin-top:8px;font-size:9px">Set your current location above first.</p>';
    return h;
  }
  h+=`<div class="found-result" style="margin-top:10px">
    <b>Step 2:</b> Pick where you would move next
    <div style="font-size:8px;color:var(--dim);margin-top:4px">Drag the gold point around the ring to choose any endpoint exactly ${qparams.travel_miles || 0.5} miles from your current location.</div>
  </div>`;
  if(qparams.thermo_dest){
    h+=`<div class="found-result" style="margin-top:8px">
      <b>Selected endpoint:</b> ${qparams.thermo_dest.lat.toFixed(4)}, ${qparams.thermo_dest.lng.toFixed(4)}
      <div style="font-size:8px;color:var(--dim);margin-top:4px">The dashed line is the divider through your current location: points in the travel direction are “closer,” points behind it are “further.”</div>
    </div>`;
  }
  return h;
}

function selectThermoDistance(miles){
  qparams.travel_miles = miles;
  qparams.thermo_dest = getDefaultThermoDest(qparams.center, miles);
  renderBuildBody();
  updatePreview();
  tryGenerate();
}

function thermoPointAtBearing(center, miles, bearing){
  if(!center || !miles) return null;
  const dest = turf.destination(turf.point([center.lng, center.lat]), miles, bearing, {units:'miles'});
  const [lng, lat] = dest.geometry.coordinates;
  return {lat, lng};
}

function getDefaultThermoDest(center, miles){
  return thermoPointAtBearing(center, miles, 90);
}

function snapThermoDest(latLng){
  if(!qparams.center || !qparams.travel_miles) return null;
  const bearing = turf.bearing(toPt(qparams.center), toPt(latLng));
  return thermoPointAtBearing(qparams.center, qparams.travel_miles, bearing);
}

function syncThermoHandleMarker(){
  if(qtype !== 'thermo'){
    clearPoiMarkers();
    return;
  }
  if(!qparams.center || !qparams.travel_miles) return;
  if(!qparams.thermo_dest) qparams.thermo_dest = getDefaultThermoDest(qparams.center, qparams.travel_miles);
  if(!thermoHandleMarker){
    thermoHandleMarker = L.marker([qparams.thermo_dest.lat, qparams.thermo_dest.lng], {
      draggable: true,
      icon: seekerPin('#f0a030'),
      zIndexOffset: 2600,
    }).addTo(map);
    thermoHandleMarker.on('drag', e => {
      const snapped = snapThermoDest(e.target.getLatLng());
      if(!snapped) return;
      e.target.setLatLng([snapped.lat, snapped.lng]);
      qparams.thermo_dest = snapped;
      updatePreview();
    });
    thermoHandleMarker.on('dragend', () => {
      renderBuildBody();
      updatePreview();
      tryGenerate();
    });
  } else {
    thermoHandleMarker.setLatLng([qparams.thermo_dest.lat, qparams.thermo_dest.lng]);
  }
}

function renderMeasureParams(){
  if(!qparams.center) return '<p class="empty" style="margin-top:6px;font-size:9px">Set your location above first.</p>';
  let h = '<div class="sec">What to Measure From</div>';

  // Group by category
  const groups = {};
  MEASURE_CATS.forEach(c=>{
    if(!groups[c.group]) groups[c.group]=[];
    groups[c.group].push(c);
  });
  Object.entries(groups).forEach(([grp, cats])=>{
    h += `<div style="font-size:7.5px;letter-spacing:0.1em;text-transform:uppercase;color:var(--dim);margin:8px 0 5px">${grp}</div>`;
    h += '<div class="poi-presets">';
    cats.forEach(c=>{
      h+=`<div class="poi-chip ${qparams._mcat===c.label?'on':''}" onclick="${_c(()=>selectMeasureCat(c))}">${c.icon} ${c.label}</div>`;
    });
    h += '</div>';
  });

  if(qparams._msearching) h+=`<div style="font-size:9px;color:var(--dim);margin-top:8px">${isSeaLevelMeasure(qparams.measure_cat_label) ? '⏳ Looking up elevation…' : '⏳ Finding nearest…'}</div>`;
  else if(qparams.measure_mode === 'elevation' && Number.isFinite(qparams.measure_seeker_elevation_ft))
    h+=`<div class="found-result" style="margin-top:8px">
      ⛰️ <b>${qparams.measure_seeker_elevation_ft.toFixed(0)} ft above sea level</b><br>
      <span style="color:var(--dim)">${qparams.measure_seeker_elevation_m.toFixed(1)} m above sea level</span><br>
      <span style="font-size:8px;color:var(--dim)">USGS point elevation estimate for your selected location</span>
    </div>`;
  else if(qparams.measure_seeker_nearest)
    h+=`<div class="found-result" style="margin-top:8px">
      📍 <b>${qparams.measure_seeker_nearest.name}</b><br>
      <span style="color:var(--dim)">${qparams.measure_seeker_dist.toFixed(2)} mi from you</span><br>
      <span style="font-size:8px;color:var(--dim)">${qparams.measure_all_instances?.length||1} instances found for zone</span>
    </div>`;
  return h;
}

function renderTentaclesParams(){
  if(!qparams.center) return '<p class="empty" style="margin-top:6px;font-size:9px">Set your location above first.</p>';
  const visibleOptions = getTentacleDisplayOptions({
    center:qparams.center,
    radius_miles:qparams.radius_miles || 1,
    options:qparams.tentacle_options || [],
  });
  let h='<div class="sec">Tentacle Type</div><div class="poi-presets">';
  TENTACLES_CATS.forEach(c=>{
    h+=`<div class="poi-chip ${qparams._tcat===c.label?'on':''}" onclick="${_c(()=>selectTentacleCat(c))}">${c.icon} ${c.label}</div>`;
  });
  h+='</div>';
  const radPresets=[{r:0.5,l:'½ mi'},{r:1,l:'1 mi'},{r:2,l:'2 mi'}];
  h+='<div class="sec">Reach Radius</div><div class="axrow">';
  radPresets.forEach(p=>{
    h+=`<div class="axbtn ${qparams.radius_miles===p.r?'on':''}" onclick="${_c(()=>{
      setParam('radius_miles',p.r);
      updatePreview();
      renderBuildBody();
      if(qparams._tcat && !qparams._tsearching){
        const catObj = TENTACLES_CATS.find(c => c.label === qparams._tcat || c.label === qparams._tcatlabel || c.label === qparams.tentacles_cat_label);
        if(catObj) selectTentacleCat(catObj);
        else if(qparams.tentacle_options) tryGenerate();
      } else if(qparams.tentacle_options){
        tryGenerate();
      }
    })}">${p.l}</div>`;
  });
  h+='</div>';
  if(qparams._tsearching) h+='<div style="font-size:9px;color:var(--dim);margin-top:6px">⏳ Searching…</div>';
  else if(visibleOptions.length){
    h+=`<div class="found-result" style="margin-top:8px">🐙 Found <b>${visibleOptions.length} options</b> nearby.<br><span style="font-size:8px;color:var(--dim)">Use the map pins to preview or apply. Anything outside the radius is ignored.</span></div>`;
  }
  return h;
}

function renderMatchingParams(){
  if(!qparams.center) return '<p class="empty" style="margin-top:6px;font-size:9px">Set your location above first.</p>';

  // ── Section 1: Are we in the same… ──
  let h = '<div class="sec" style="margin-top:4px">Are we in the same…</div>';
  h += '<div style="display:flex;flex-direction:column;gap:5px;margin-top:6px">';
  MATCHING_CATS.forEach(c=>{
    const sel = qparams.matching_cat === c.cat;
    h += `<div class="sitem${sel?' active-row':''}" style="${sel?'border-color:var(--purple);background:rgba(160,96,255,0.08)':''}"
      onclick="${_c(()=>selectMatchingCat(c))}">
      <span style="font-size:16px;margin-right:10px;vertical-align:middle">${c.icon}</span>
      <span style="vertical-align:middle">${c.label}?</span>
      ${c.cat==='landmass' && !_landmassCache.ready ? '<span style="float:right;font-size:8px;color:var(--gold)">⏳ loading…</span>' : ''}
      ${sel?'<span style="float:right;color:var(--purple);font-size:9px">✓</span>':''}
    </div>`;
  });
  h += '</div>';
  if(qparams._matching_searching)
    h += '<div style="font-size:9px;color:var(--dim);margin-top:8px">⏳ Looking up your location and boundary…</div>';
  else if(qparams.matching_cat === 'line'){
    h += '<div class="sec" style="margin-top:10px">Choose Line</div>';
    h += '<div style="display:flex;flex-direction:column;gap:5px">';
    GAME_LINES.forEach(line=>{
      const sel = qparams.matching_line_id === line.id;
      h += `<div class="sitem${sel?' active-row':''}" style="${sel?'border-color:var(--purple);background:rgba(160,96,255,0.08);color:var(--text)':''}" onclick="${_c(()=>selectMatchingLine(line.id))}">
        <span style="display:inline-block;width:9px;height:9px;border-radius:50%;background:${line.color};margin-right:8px;vertical-align:middle"></span>
        <span style="vertical-align:middle">${line.label}</span>
        ${sel?'<span style="float:right;color:var(--purple);font-size:9px">✓</span>':''}
      </div>`;
    });
    h += '</div>';
  }
  else if(qparams.matching_seeker_val){
    const hasBoundary = !!qparams.matching_boundary;
    h += `<div class="found-result" style="margin-top:8px">
      <b>${qparams.matching_cat_label}:</b> ${qparams.matching_seeker_val}
      <div style="font-size:8px;color:${hasBoundary?'var(--green)':'var(--gold)'};margin-top:4px">
        ${hasBoundary ? '✓ Boundary loaded — zone will update on answer' : '⚠ No boundary — informational only'}
      </div>
    </div>`;
  }

  // ── Section 2: Is the nearest ___ the same… ──
  h += '<div class="sec" style="margin-top:14px;padding-top:14px;border-top:1px solid var(--border)">Is the nearest ___ to me the same as to you?</div>';
  h += '<div style="display:flex;flex-direction:column;gap:5px;margin-top:6px">';
  NEAREST_CATS.forEach(c=>{
    const sel = qparams.nearest_cat === c.label;
    h += `<div class="sitem${sel?' active-row':''}" style="${sel?'border-color:var(--teal);background:rgba(32,200,176,0.08)':''}"
      onclick="${_c(()=>selectNearestCat(c))}">
      <span style="font-size:16px;margin-right:10px;vertical-align:middle">${c.icon}</span>
      <span style="vertical-align:middle">${c.label}</span>
      ${sel?'<span style="float:right;color:var(--teal);font-size:9px">✓</span>':''}
    </div>`;
  });
  h += '</div>';
  if(qparams._nearest_searching)
    h += '<div style="font-size:9px;color:var(--dim);margin-top:8px">⏳ Searching for nearby options…</div>';
  else if(qparams.nearest_seeker_poi){
    const hasPoly = !!qparams.nearest_voronoi;
    h += `<div class="found-result" style="margin-top:8px">
      <b>Your nearest ${qparams.nearest_cat_label}:</b> ${qparams.nearest_seeker_poi.name}<br>
      <span style="color:var(--dim);font-size:8px">${qparams.nearest_all_pois?.length||0} total options found</span>
      <div style="font-size:8px;color:${hasPoly?'var(--green)':'var(--gold)'};margin-top:3px">
        ${hasPoly?'✓ Voronoi zone computed':'⚠ Not enough options for zone — informational only'}
      </div>
    </div>`;
  }

  return h;
}

async function selectMatchingCat(catObj){
  if(!qparams.center){ toast('Set your location first'); return; }
  if(catObj.cat === 'landmass' && !_landmassCache.ready){
    toast('⏳ Still loading landmasses — try again in a moment'); return;
  }
  qparams._matching_mode = 'matching';
  qparams.matching_cat = catObj.cat;
  qparams.matching_cat_label = catObj.label;
  if(catObj.cat !== 'line'){
    qparams.matching_line_id = null;
    qparams.matching_line_label = null;
    qparams.matching_hide_radius_miles = null;
  }
  qparams.matching_seeker_val = null;
  qparams.matching_boundary = null;
  qparams.nearest_cat = null;
  qparams.nearest_cat_label = null;
  qparams.nearest_seeker_poi = null;
  qparams.nearest_all_pois = null;
  qparams.nearest_voronoi = null;
  highlightBoundary(catObj.cat);
  if(catObj.cat === 'line' && !qparams.matching_line_id){
    qparams._matching_searching = false;
    renderBuildBody();
    return;
  }
  qparams._matching_searching = true;
  renderBuildBody();
  try{
    const result = await catObj.resolve(qparams.center, {
      lineId: qparams.matching_line_id,
      hideRadiusMiles: hideRadiusMi,
    });
    qparams._matching_searching = false;
    if(!result.val){ toast('Could not determine your '+catObj.label+' — try a different location'); renderBuildBody(); return; }
    qparams.matching_seeker_val = result.val;
    if(result.line_id){
      qparams.matching_line_id = result.line_id;
      qparams.matching_line_label = result.val;
      qparams.matching_hide_radius_miles = hideRadiusMi;
    }
    // Normalize: ensure seeker's point is INSIDE the polygon, flip if not
    let boundary = result.boundary || null;
    if(boundary && catObj.cat !== 'line'){
      try{
        const pt = turf.point([qparams.center.lng, qparams.center.lat]);
        if(!turf.booleanPointInPolygon(pt, boundary)){
          const BBOX = turf.bboxPolygon([-72.5, 41.5, -70.0, 43.0]);
          const flipped = turf.difference(BBOX, boundary);
          if(flipped && turf.booleanPointInPolygon(pt, flipped)){
            boundary = flipped;
            console.log('Boundary flipped for', result.val);
          }
        }
        // Simplify to avoid freezing on mobile
        boundary = turf.simplify(boundary, {tolerance:0.0005, highQuality:false});
      }catch(e){ console.warn('Boundary normalize/simplify failed:', e); }
    }
    qparams.matching_boundary = boundary;
    qparams._matching_boundary_simplified = boundary; // already simplified
    if(result.boundary){
      toast(`✓ Got boundary for ${result.val}`);
    } else {
      toast(`⚠ No boundary found for ${result.val} — question will be informational only`);
    }
    renderBuildBody();
    tryGenerate();
  } catch(e){
    qparams._matching_searching = false;
    toast('Lookup failed: '+e.message);
    renderBuildBody();
  }
}

async function selectMatchingLine(lineId){
  const catObj = MATCHING_CATS.find(c => c.cat === 'line');
  const line = GAME_LINES.find(gl => gl.id === lineId);
  if(!catObj || !line){ toast('Unknown line'); return; }
  qparams.matching_line_id = line.id;
  qparams.matching_line_label = line.label;
  await selectMatchingCat(catObj);
}

async function selectNearestCat(catObj){
  if(!qparams.center){ toast('Set your location first'); return; }
  qparams._matching_mode = 'nearest';
  qparams.matching_cat = null;
  qparams.matching_cat_label = null;
  qparams.matching_seeker_val = null;
  qparams.matching_boundary = null;
  qparams._matching_boundary_simplified = null;
  qparams.nearest_cat = catObj.label;
  qparams.nearest_cat_label = catObj.label;
  qparams.nearest_seeker_poi = null;
  qparams.nearest_all_pois = null;
  qparams.nearest_voronoi = null;
  qparams._nearest_searching = true;
  renderBuildBody();
  try{
    const radiusM = 35000;
    const pois = await getCategoryInstances(catObj, qparams.center, radiusM);
    qparams._nearest_searching = false;
    if(!pois.length){ toast('No '+catObj.label+' found nearby'); renderBuildBody(); return; }
    pois.sort((a,b)=>turfDist(qparams.center,a)-turfDist(qparams.center,b));
    qparams.nearest_seeker_poi = pois[0];
    qparams.nearest_all_pois = pois.slice(0,20);

    if(pois.length >= 2){
      try{
        const fc = turf.featureCollection(pois.map(p=>turf.point([p.lng,p.lat])));
        const cells = turf.voronoi(fc, {bbox:[-72,41.5,-70,43]});
        if(cells && cells.features.length){
          // Find cell containing the nearest POI point
          const nearestPt = turf.point([pois[0].lng, pois[0].lat]);
          const seekerPt  = turf.point([qparams.center.lng, qparams.center.lat]);
          const correctCell = cells.features.find(cell=>{
            try{ return turf.booleanPointInPolygon(nearestPt, cell); }catch(e){ return false; }
          });
          if(correctCell){
            // Verify seeker is also inside this cell (they should be, since it's their nearest POI)
            const seekerInside = (()=>{ try{ return turf.booleanPointInPolygon(seekerPt, correctCell); }catch(e){ return false; }})();
            qparams.nearest_voronoi = seekerInside ? correctCell : null;
            if(!seekerInside) console.warn('Nearest: seeker not in correct Voronoi cell — no zone update');
          }
          // Drop teardrop pins — gold #1 for nearest, blue for rest
          clearPoiMarkers();
          pois.slice(0,100).forEach((p,i)=>{
            const col = i===0 ? '#f0a030' : '#4a7090';
            const m = L.marker([p.lat,p.lng],{icon:tentaclePin(i+1,col),zIndexOffset:1500+i})
              .bindPopup(`<div class="stop-popup"><div class="stop-popup-name">${p.name}</div>${i===0?'<div style="font-size:9px;color:#f0a030;margin-top:2px">★ Your nearest</div>':''}</div>`,{offset:[0,-28],maxWidth:220})
              .addTo(map);
            pickedMarkers.push(m);
          });
          map.fitBounds(L.latLngBounds([[pois[0].lat,pois[0].lng],[qparams.center.lat,qparams.center.lng]]).pad(0.3));
        }
      }catch(e){ console.warn('Voronoi failed:',e); }
    }
    renderBuildBody(); tryGenerate();
  }catch(e){ qparams._nearest_searching=false; toast('Search failed: '+e.message); renderBuildBody(); }
}

function renderPhotoParams(){
  let h='<div class="photo-grid">';
  PHOTO_PROMPTS.forEach(p=>{
    const sel=qparams.photo_prompt===p.text;
    h+=`<div class="photo-opt ${sel?'on':''}" onclick="${_c(()=>{qparams.photo_prompt=p.text;tryGenerate();renderBuildBody();})}">
      <span class="po-icon">${p.icon}</span><span class="po-text">${p.text}</span></div>`;
  });
  h+='</div>';
  h+=`<div class="sec">Or Custom Prompt</div>
  <textarea class="jarea" rows="2" placeholder="Describe what to photograph…"
    oninput="qparams.photo_prompt=this.value;tryGenerate()">${qparams.photo_prompt&&!PHOTO_PROMPTS.find(p=>p.text===qparams.photo_prompt)?qparams.photo_prompt:''}</textarea>`;
  return h;
}

function renderCustomBoundaryParams(){
  const pts = qparams.custom_boundary_points || [];
  const mode = qparams.custom_boundary_mode || '';
  const ready = pts.length >= 3 && !!qparams.custom_boundary_geojson;
  let h = '<div class="sec">Custom Boundary</div>';
  h += '<p class="empty" style="margin-bottom:10px">Draw a polygon on the map, then include only that area or exclude it from the current zone.</p>';
  h += `<div class="found-result" style="margin-top:0">
    <b>${pts.length}</b> point${pts.length===1?'':'s'} placed
    <div style="font-size:8px;color:var(--dim);margin-top:4px">${ready?'Boundary ready. Preview or apply it below.':'Tap at least 3 points to make a polygon.'}</div>
  </div>`;
  h += `<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px">
    <button class="btn btn-sec" onclick="${_c(()=>startCustomBoundaryDraw())}">${qparams._drawingBoundary?'✏️ Drawing…':'✏️ Draw On Map'}</button>
    <button class="btn btn-ghost" onclick="${_c(()=>undoCustomBoundaryPoint())}" ${pts.length?'':'disabled'}>↶ Undo</button>
    <button class="btn btn-ghost" onclick="${_c(()=>clearCustomBoundary())}" ${pts.length?'':'disabled'}>✕ Clear</button>
  </div>`;
  h += '<div class="sec">Apply Mode</div><div class="axrow">';
  h += `<div class="axbtn ${mode==='include'?'on':''}" onclick="${_c(()=>setCustomBoundaryMode('include'))}">Include</div>`;
  h += `<div class="axbtn ${mode==='exclude'?'on':''}" onclick="${_c(()=>setCustomBoundaryMode('exclude'))}">Exclude</div>`;
  h += '</div>';
  if(ready){
    h += `<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px">
      <button class="btn btn-red" onclick="${_c(()=>applyCustomBoundary())}" ${mode?'':'disabled'}>Apply To Zone</button>
    </div>`;
  }
  return h;
}

// Helpers for param rendering
function setParam(k,v){ qparams[k]=v; }
function tryGenerate(){
  const activeType = getActiveBuildQType();
  if(qtype && QDEFS[activeType] && QDEFS[activeType].isReady(qparams)) generateJSON();
}

function maybeAutoResolveBuildQuestion(){
  if(!qparams.center) return;

  if(qtype === 'matching'){
    if(qparams._matching_mode === 'nearest'){
      if(qparams.nearest_cat && !qparams.nearest_seeker_poi && !qparams._nearest_searching){
        const catObj = NEAREST_CATS.find(c => c.label === qparams.nearest_cat || c.label === qparams.nearest_cat_label);
        if(catObj) selectNearestCat(catObj);
      }
      return;
    }
    if(qparams.matching_cat && !qparams.matching_seeker_val && !qparams._matching_searching){
      const catObj = MATCHING_CATS.find(c => c.cat === qparams.matching_cat);
      if(catObj) selectMatchingCat(catObj);
    }
    return;
  }

  if(qtype === 'measure'){
    const ready = qparams.measure_mode === 'elevation'
      ? Number.isFinite(qparams.measure_seeker_elevation_ft)
      : qparams.measure_seeker_dist != null;
    if(qparams.measure_cat && !ready && !qparams._msearching){
      const catObj = MEASURE_CATS.find(c => c.label === qparams.measure_cat || c.label === qparams.measure_cat_label);
      if(catObj) selectMeasureCat(catObj);
    }
    return;
  }

  if(qtype === 'tentacles'){
    if(qparams._tcat && !(qparams.tentacle_options?.length) && !qparams._tsearching){
      const catObj = TENTACLES_CATS.find(c => c.label === qparams._tcat || c.label === qparams.tentacles_cat_label);
      if(catObj) selectTentacleCat(catObj);
    }
  }
}

function startCustomBoundaryDraw(){
  qparams._drawingBoundary = true;
  qparams.custom_boundary_points = qparams.custom_boundary_points || [];
  showBanner('TAP THE MAP — add boundary vertices');
  document.getElementById('panel').classList.add('collapsed');
  renderBoundaryBody();
}

function undoCustomBoundaryPoint(){
  if(!qparams.custom_boundary_points?.length) return;
  qparams.custom_boundary_points.pop();
  const marker = seekerPinMarkers.pop();
  if(marker) marker.remove();
  qparams.custom_boundary_geojson = buildCustomBoundaryFeature(qparams.custom_boundary_points);
  syncCustomBoundaryPreview();
  updatePreview();
  renderBoundaryBody();
}

function clearCustomBoundary(){
  qparams.custom_boundary_points = [];
  qparams.custom_boundary_geojson = null;
  qparams.custom_boundary_mode = null;
  qparams._drawingBoundary = false;
  clearMarkers();
  previewLayer.clearLayers();
  simulLayer.clearLayers();
  simulMaskLayer.clearLayers();
  setPreviewMapMode(false);
  document.getElementById('map-simul-bar').classList.remove('visible');
  const hint = document.getElementById('simul-hint');
  if(hint) hint.className = 'simul-result-hint';
  hideBanner();
  renderBoundaryBody();
}

function setCustomBoundaryMode(mode){
  qparams.custom_boundary_mode = mode;
  syncCustomBoundaryPreview();
  renderBoundaryBody();
}

function syncCustomBoundaryPreview(){
  if(qtype !== 'custom_boundary') return;
  const poly = qparams.custom_boundary_geojson || buildCustomBoundaryFeature(qparams.custom_boundary_points || []);
  qparams.custom_boundary_geojson = poly;
  const ready = !!poly && !!qparams.custom_boundary_mode;
  if(!ready){
    clearZonePreview();
    document.getElementById('map-simul-bar').classList.remove('visible');
    const hint = document.getElementById('simul-hint');
    if(hint){
      hint.innerHTML = '';
      hint.className = 'simul-result-hint';
    }
    const msb = document.getElementById('msb-area');
    if(msb) msb.innerHTML = 'green stays · red goes';
    return;
  }
  previewCustomBoundary(qparams.custom_boundary_mode);
}

// ── Category data — Overpass tags ──
// Each entry has: icon, label, and an overpass() fn that returns the Overpass query body
// for a given {lat,lng,radiusM}
// ── Measure categories ──
// Each has: icon, label, group, and either overpass() or resolve() (async, returns {lat,lng,name})
// ── Measure helpers ──

// ── Administrative boundary loader ──
// Stores fetched relation geometries keyed by OSM id for later highlight lookup
const _adminBoundaries = { counties: [], towns: [] };

async function loadAdminBoundaries(){
  try{
    const staticData = preloadedData.boundaries || await fetchOptionalJSON(DATA_FILES.boundaries, 'boundaries');
    if(staticData){
      preloadedData.boundaries = staticData;
      _adminBoundaries.counties = (getBoundaryDataset('county') || []).flatMap(item => {
        const feature = coerceFeature(item, item.name);
        return featureToDisplayLines(feature).map(line => ({
          ...line,
          properties: {...(line.properties || {}), name: item.name || feature?.properties?.name || '', admin_level: '6'},
        }));
      });
      _adminBoundaries.towns = (getBoundaryDataset('city') || []).flatMap(item => {
        const feature = coerceFeature(item, item.name);
        return featureToDisplayLines(feature).map(line => ({
          ...line,
          properties: {...(line.properties || {}), name: item.name || feature?.properties?.name || '', admin_level: '8'},
        }));
      });
      if(countyLayer) countyLayer.addData({type:'FeatureCollection',features:_adminBoundaries.counties});
      if(townLayer) townLayer.addData({type:'FeatureCollection',features:_adminBoundaries.towns});
      console.log(`Admin boundaries: ${_adminBoundaries.counties.length} county segments, ${_adminBoundaries.towns.length} town segments`);
      return;
    }

    // Fetch counties (admin_level=6) and towns/cities (admin_level=8) in one query
    const q=`[out:json][timeout:30];(
      relation["admin_level"="6"]["boundary"="administrative"](${S},${W},${N},${E});
      relation["admin_level"="8"]["boundary"="administrative"](${S},${W},${N},${E});
    );out geom 2000;`;
    const data = await overpassRaw(q);

    (data.elements||[]).forEach(rel=>{
      if(rel.type!=='relation') return;
      const level = rel.tags?.admin_level;
      const name  = rel.tags?.name || '';
      // Convert member ways to GeoJSON LineStrings for display
      (rel.members||[]).forEach(m=>{
        if(m.type!=='way'||!m.geometry||m.geometry.length<2) return;
        const coords = m.geometry.map(p=>[p.lon,p.lat]);
        const feat = {type:'Feature',properties:{name,admin_level:level,rel_id:rel.id},geometry:{type:'LineString',coordinates:coords}};
        if(level==='6') _adminBoundaries.counties.push(feat);
        else if(level==='8') _adminBoundaries.towns.push(feat);
      });
    });

    // Add to map layers
    if(countyLayer) countyLayer.addData({type:'FeatureCollection',features:_adminBoundaries.counties});
    if(townLayer)   townLayer.addData({type:'FeatureCollection',features:_adminBoundaries.towns});
    console.log(`Admin boundaries: ${_adminBoundaries.counties.length} county segments, ${_adminBoundaries.towns.length} town segments`);
  }catch(e){ console.warn('Admin boundary load failed:', e); }
}

// Highlight boundaries relevant to the active question category
function highlightBoundary(cat){
  if(!boundaryHighlightLayer) return;
  boundaryHighlightLayer.clearLayers();
  boundaryHighlightLayer.remove();

  let features = [];
  if(cat === 'county' || cat === 'A County Border'){
    features = _adminBoundaries.counties;
  } else if(cat === 'city' || cat === 'A City Border'){
    features = _adminBoundaries.towns;
  }
  if(!features.length) return;

  boundaryHighlightLayer.clearLayers();
  boundaryHighlightLayer.addData({type:'FeatureCollection',features});
  boundaryHighlightLayer.addTo(map);
}

function clearBoundaryHighlight(){
  if(!boundaryHighlightLayer) return;
  boundaryHighlightLayer.clearLayers();
  boundaryHighlightLayer.remove();
}

// Raw Overpass fetch returning parsed JSON
async function overpassRaw(query){
  const endpoints=['https://overpass-api.de/api/interpreter','https://overpass.kumi.systems/api/interpreter'];
  for(const url of endpoints){
    try{
      const res=await fetch(url,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:'data='+encodeURIComponent(query)});
      if(res.ok) return await res.json();
    }catch(e){}
  }
  return {elements:[]};
}

// Convert Overpass way geometries to a list of evenly-spaced points (every `stepMiles`)
function densifyWaysToPoints(data, stepMiles=0.25){
  const pts=[];
  const seen=new Set();
  (data.elements||[]).forEach(el=>{
    if(el.type!=='way'||!el.geometry) return;
    const coords=el.geometry.map(p=>[p.lon,p.lat]);
    if(coords.length<2) return;
    const line=turf.lineString(coords);
    const len=turf.length(line,{units:'miles'});
    const steps=Math.max(1,Math.round(len/stepMiles));
    for(let i=0;i<=steps;i++){
      try{
        const pt=turf.along(line,(i/steps)*len,{units:'miles'});
        const [lng,lat]=pt.geometry.coordinates;
        const key=`${lat.toFixed(4)},${lng.toFixed(4)}`;
        if(!seen.has(key)){seen.add(key);pts.push({lat,lng,name:el.tags?.name||'Track'});}
      }catch(e){}
    }
  });
  return pts;
}

// Fetch border polygon and return densified points along the nearest edge
async function nearestBorderPoints(center, type, adminLevel){
  const name = type==='county' ? 'Massachusetts counties' : 'Massachusetts municipalities';
  // Fetch all admin boundaries of the given level in the area
  const pad=0.3;
  const s=center.lat-pad,n=center.lat+pad,w=center.lng-pad,e=center.lng+pad;
  const q=`[out:json][timeout:25];relation["admin_level"="${adminLevel}"]["boundary"="administrative"](${s},${w},${n},${e});out geom 500;`;
  const data=await overpassRaw(q);
  // Collect all way geometry points from all matching relations
  const pts=[];
  const seen=new Set();
  (data.elements||[]).forEach(el=>{
    if(el.type!=='relation'||!el.members) return;
    el.members.forEach(m=>{
      if(m.type!=='way'||!m.geometry) return;
      m.geometry.forEach(p=>{
        const key=`${p.lat.toFixed(4)},${p.lon.toFixed(4)}`;
        if(!seen.has(key)){seen.add(key);pts.push({lat:p.lat,lng:p.lon,name:'Border'});}
      });
    });
  });
  return pts;
}

const MEASURE_CATS = [
  // TRANSIT
  { group:'Transit', icon:'🚆', label:'An Amtrak Line',
    instances: async (c) => {
      await loadPoiData();
      const preloaded = getNamedLinearCollection('An Amtrak Line');
      if(preloaded.length) return preloaded;
      // Fetch NEC and Downeaster route relations by name across the full MBTA bounding box
      // Using relation-based query to get entire track, not just nearby sections
      const S=41.0, N=43.5, W=-72.0, E=-70.0; // broad bbox covering NEC Boston-Providence + Downeaster to Portland
      const q = `[out:json][timeout:30];(
        relation["route"="train"]["operator"~"Amtrak",i](${S},${W},${N},${E});
        relation["route"="train"]["name"~"Downeaster|Northeast Corridor|NEC|Acela|Regional",i](${S},${W},${N},${E});
      );out geom 500;`;
      const data = await overpassRaw(q);
      // Relations return members with geometry
      const pts = [];
      const seen = new Set();
      (data.elements||[]).forEach(el=>{
        if(el.type!=='relation') return;
        (el.members||[]).forEach(m=>{
          if(m.type!=='way'||!m.geometry) return;
          m.geometry.forEach(p=>{
            const key=`${p.lat.toFixed(3)},${p.lon.toFixed(3)}`;
            if(!seen.has(key)){ seen.add(key); pts.push({lat:p.lat, lng:p.lon, name:'Amtrak track'}); }
          });
        });
      });
      if(pts.length) return pts;
      // Fallback: way-based query if relations returned nothing
      const q2=`[out:json][timeout:30];way["railway"="rail"]["usage"="main"](${S},${W},${N},${E});out geom 300;`;
      const data2=await overpassRaw(q2);
      return densifyWaysToPoints(data2, 0.3);
    }},
  { group:'Transit', icon:'🚉', label:'A Commuter Rail Station',
    instances: async (c) => {
      const list = commuterRailStopsList.length ? commuterRailStopsList : [];
      // Filter to stops within the T network's playable footprint
      const T_BBOX = {minLat:42.18, maxLat:42.67, minLng:-71.55, maxLng:-70.85};
      return list.filter(s =>
        s.lat >= T_BBOX.minLat && s.lat <= T_BBOX.maxLat &&
        s.lng >= T_BBOX.minLng && s.lng <= T_BBOX.maxLng
      );
    }},

  // BORDERS
  { group:'Borders', icon:'🏛️', label:'A County Border',
    instances: async (c) => {
      await loadBoundaryData();
      const preloaded = getPreloadedBorderPoints('county');
      return preloaded.length ? preloaded : nearestBorderPoints(c, 'county', 6);
    } },
  { group:'Borders', icon:'🏙️', label:'A City Border',
    instances: async (c) => {
      await loadBoundaryData();
      const preloaded = getPreloadedBorderPoints('city');
      return preloaded.length ? preloaded : nearestBorderPoints(c, 'city', 8);
    } },

  // NATURAL
  { group:'Natural', icon:'🌊', label:'Sea Level',
    instances: async (c) => {
      await loadPoiData();
      const preloaded = getNamedPoiCollection('Sea Level');
      if(preloaded.length) return preloaded;
      // Harbor shoreline: fetch coastline ways and densify
      const r = 50000;
      const q = `[out:json][timeout:25];way["natural"="coastline"](around:${r},${c.lat},${c.lng});out geom 300;`;
      const data = await overpassRaw(q);
      const pts = densifyWaysToPoints(data, 0.2);
      return pts.length ? pts : [{lat:42.3551, lng:-71.0497, name:'Boston Harbor shore'}];
    }},
  { group:'Natural', icon:'💧', label:'A Body of Water',
    instances: async (c) => {
      await loadPoiData();
      const preloadedLines = getNamedLinearCollection('A Body of Water');
      if(preloadedLines.length) return preloadedLines;
      const r = 35000;
      const q = `[out:json][timeout:35];(
        way["natural"~"^(water|bay)$"]["name"](around:${r},${c.lat},${c.lng});
        relation["natural"~"^(water|bay)$"]["name"](around:${r},${c.lat},${c.lng});
        way["waterway"~"^(river|canal)$"]["name"](around:${r},${c.lat},${c.lng});
        way["waterway"="riverbank"]["name"](around:${r},${c.lat},${c.lng});
        relation["waterway"="riverbank"]["name"](around:${r},${c.lat},${c.lng});
      );out geom 500;`;
      const data = await overpassRaw(q);
      const lineFeatures = waterLineFeaturesFromOverpass(data, 'Water');
      const points = lineFeatures.flatMap(item => pointsFromFeatureGeometry(coerceFeature(item, item.name), item.name));
      return points.length ? points : getNamedPoiCollection('A Body of Water');
    }},
  { group:'Natural', icon:'🏖️', label:'A Coastline',
    instances: async (c) => {
      await loadPoiData();
      const preloaded = getNamedPoiCollection('A Coastline');
      if(preloaded.length) return preloaded;
      const r = 50000;
      const q = `[out:json][timeout:25];way["natural"="coastline"](around:${r},${c.lat},${c.lng});out geom 300;`;
      const data = await overpassRaw(q);
      const pts = densifyWaysToPoints(data, 0.2);
      return pts.length ? pts : [{lat:42.3551, lng:-71.0497, name:'Boston coastline'}];
    }},
  { group:'Natural', icon:'🌳', label:'A Park',
    instances: async ()=>{ await loadPoiData(); return getNamedPoiCollection('A Park'); },
    overpass:(c,r)=>`nwr["leisure"="park"]["name"](around:${r},${c.lat},${c.lng});` },

  // PLACES OF INTEREST
  { group:'Places of Interest', icon:'🎢', label:'An Amusement Park',
    instances: async ()=>{ await loadPoiData(); return getNamedPoiCollection('An Amusement Park'); },
    overpass:(c,r)=>`nwr["tourism"="theme_park"](around:${r},${c.lat},${c.lng});nwr["leisure"="amusement_arcade"](around:${r},${c.lat},${c.lng});` },
  { group:'Places of Interest', icon:'🦒', label:'A Zoo / Aquarium',
    instances: async ()=>{ await loadPoiData(); return getNamedPoiCollection('A Zoo / Aquarium'); },
    overpass:(c,r)=>`nwr["tourism"~"^(zoo|aquarium)$"](around:${r},${c.lat},${c.lng});` },
  { group:'Places of Interest', icon:'⛳', label:'A Golf Course',
    instances: async ()=>{ await loadPoiData(); return getNamedPoiCollection('A Golf Course'); },
    overpass:(c,r)=>`nwr["leisure"="golf_course"](around:${r},${c.lat},${c.lng});` },
  { group:'Places of Interest', icon:'🏛️', label:'A Museum',
    instances: async ()=>{ await loadPoiData(); return getNamedPoiCollection('A Museum'); },
    overpass:(c,r)=>`nwr["tourism"="museum"](around:${r},${c.lat},${c.lng});` },
  { group:'Places of Interest', icon:'🎬', label:'A Movie Theater',
    instances: async ()=>{ await loadPoiData(); return getNamedPoiCollection('A Movie Theater'); },
    overpass:(c,r)=>`nwr["amenity"="cinema"](around:${r},${c.lat},${c.lng});` },

  // PUBLIC UTILITIES
  { group:'Public Utilities', icon:'🏥', label:'A Hospital',
    instances: async ()=>{ await loadPoiData(); return getNamedPoiCollection('A Hospital'); },
    overpass:(c,r)=>`nwr["amenity"="hospital"](around:${r},${c.lat},${c.lng});` },
  { group:'Public Utilities', icon:'📚', label:'A Library',
    instances: async ()=>{ await loadPoiData(); return getNamedPoiCollection('A Library'); },
    overpass:(c,r)=>`nwr["amenity"="library"](around:${r},${c.lat},${c.lng});` },
  { group:'Public Utilities', icon:'🏳️', label:'A Foreign Consulate',
    instances: async ()=>{ await loadPoiData(); return getNamedPoiCollection('A Foreign Consulate'); },
    overpass:(c,r)=>`nwr["office"~"diplomatic|consulate"](around:${r},${c.lat},${c.lng});nwr["amenity"="embassy"](around:${r},${c.lat},${c.lng});` },
];

const TENTACLES_CATS = [
  {icon:'🏥', label:'Hospitals',    overpass:(c,r)=>`nwr["amenity"~"hospital|clinic"](around:${r},${c.lat},${c.lng});`},
  {icon:'📚', label:'Libraries',    overpass:(c,r)=>`nwr["amenity"="library"](around:${r},${c.lat},${c.lng});`},
  {icon:'🏛️', label:'Museums',     overpass:(c,r)=>`nwr["tourism"="museum"](around:${r},${c.lat},${c.lng});`},
  {icon:'🎬', label:'Movie Theaters', overpass:(c,r)=>`nwr["amenity"="cinema"](around:${r},${c.lat},${c.lng});`},
  {icon:'☕', label:"Dunkin'",      overpass:(c,r)=>`nwr["name"~"Dunkin",i](around:${r},${c.lat},${c.lng});`},
];

// ── Overpass API search ──
const RANDOMIZE_RADAR_PRESETS = [
  {radius_miles:0.25, label:'¼ mi'},
  {radius_miles:0.5, label:'½ mi'},
  {radius_miles:1, label:'1 mi'},
  {radius_miles:3, label:'3 mi'},
  {radius_miles:5, label:'5 mi'},
  {radius_miles:10, label:'10 mi'},
  {radius_miles:25, label:'25 mi'},
];

const RANDOMIZE_THERMO_PRESETS = [
  {travel_miles:0.5, label:'1/2 mi'},
  {travel_miles:3, label:'3 mi'},
  {travel_miles:10, label:'10 mi'},
];

const RANDOMIZE_TENTACLE_PRESETS = [
  {radius_miles:0.5, label:'½ mi'},
  {radius_miles:1, label:'1 mi'},
  {radius_miles:2, label:'2 mi'},
];

function getRandomizeQuestionCatalog(){
  const items = [];
  RANDOMIZE_RADAR_PRESETS.forEach(preset => {
    items.push({
      build_qtype:'radar',
      question_type:'radar',
      label:`Radar · ${preset.label}`,
      radius_miles:preset.radius_miles,
    });
  });
  RANDOMIZE_THERMO_PRESETS.forEach(preset => {
    items.push({
      build_qtype:'thermo',
      question_type:'thermo',
      label:`Thermometer · ${preset.label}`,
      travel_miles:preset.travel_miles,
    });
  });
  MEASURE_CATS.forEach(cat => {
    items.push({
      build_qtype:'measure',
      question_type:'measure',
      label:`Measure · ${cat.label}`,
      category:cat.label,
      category_label:cat.label,
    });
  });
  TENTACLES_CATS.forEach(cat => {
    RANDOMIZE_TENTACLE_PRESETS.forEach(preset => {
      items.push({
        build_qtype:'tentacles',
        question_type:'tentacles',
        label:`Tentacles · ${cat.label} · ${preset.label}`,
        category:cat.label,
        category_label:cat.label,
        radius_miles:preset.radius_miles,
      });
    });
  });
  MATCHING_CATS.forEach(cat => {
    if(cat.cat === 'line'){
      GAME_LINES.forEach(line => {
        items.push({
          build_qtype:'matching',
          question_type:'matching',
          mode:'matching',
          label:`Matching · ${cat.label} · ${line.label}`,
          category:cat.cat,
          category_label:cat.label,
          line_id:line.id,
          seeker_val:line.label,
          hide_radius_miles:hideRadiusMi,
        });
      });
      return;
    }
    items.push({
      build_qtype:'matching',
      question_type:'matching',
      mode:'matching',
      label:`Matching · ${cat.label}`,
      category:cat.cat,
      category_label:cat.label,
    });
  });
  NEAREST_CATS.forEach(cat => {
    items.push({
      build_qtype:'matching',
      question_type:'nearest',
      mode:'nearest',
      label:`Nearest · ${cat.label}`,
      category:cat.label,
      category_label:cat.label,
    });
  });
  PHOTO_PROMPTS.forEach(prompt => {
    items.push({
      build_qtype:'photo',
      question_type:'photo',
      label:`Photo · ${prompt.text}`,
      prompt:prompt.text,
    });
  });
  return items;
}

function chooseRandomizedQuestionPreset(sourceQuestion=null){
  const catalog = getRandomizeQuestionCatalog();
  if(!catalog.length) return null;
  const sourceType = sourceQuestion?.type || null;
  const pool = sourceType
    ? catalog.filter(item => item.question_type === sourceType)
    : catalog;
  const choices = pool.length ? pool : catalog;
  return cloneForStorage(choices[Math.floor(Math.random() * choices.length)]);
}

async function overpassSearch(overpassBody, near, radiusM=5000){
  const query = `[out:json][timeout:25];(${overpassBody});out center 100;`;
  // Try primary, fall back to mirror
  const endpoints = [
    'https://overpass-api.de/api/interpreter',
    'https://overpass.kumi.systems/api/interpreter'
  ];
  let data;
  for(const url of endpoints){
    try{
      const res = await fetch(url, {
        method:'POST',
        headers:{'Content-Type':'application/x-www-form-urlencoded'},
        body:'data='+encodeURIComponent(query)
      });
      if(!res.ok) continue;
      data = await res.json();
      break;
    }catch(e){ continue; }
  }
  if(!data){ throw new Error('Overpass API unavailable'); }
  const elements = (data.elements||[]).filter(e=>e.tags&&e.tags.name);
  const pts = elements.map(e=>({
    name: e.tags.name,
    lat:  e.lat  ?? e.center?.lat,
    lng:  e.lon  ?? e.center?.lon,
    id:   e.id
  })).filter(p=>p.lat&&p.lng);
  pts.sort((a,b)=>turfDist({lat:a.lat,lng:a.lng},near)-turfDist({lat:b.lat,lng:b.lng},near));
  return pts;
}

// Build a short street-aware label for a place using reverse geocode
async function shortLabel(name, lat, lng){
  try{
    const r = await fetch(`https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&addressdetails=1`,{headers:{'Accept-Language':'en-US'}});
    const d = await r.json();
    const addr = d.address||{};
    const road = addr.road||addr.pedestrian||addr.footway||addr.path||'';
    const hood = addr.suburb||addr.neighbourhood||addr.quarter||'';
    const loc  = road || hood;
    return loc ? `${name} — ${loc}` : name;
  }catch(e){ return name; }
}

// ══════════════════════════════════════════════════════
//  MARKER ICONS
// ══════════════════════════════════════════════════════

// Seeker "you are here" — bold red crosshair pin with pulsing ring
function makeStopIcon(colors){
  const n = colors.length;

  const r = n > 1 ? 6 : 5;

  const pad  = 2;
  const size = (r + pad) * 2;
  const cx   = size / 2, cy = size / 2;

  // ── Inner circle / pie ──
  let innerSVG = '';
  if(n === 1){
    innerSVG = `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${colors[0]}" stroke="white" stroke-width="1.5"/>`;
  } else {
    const TAU = 2 * Math.PI;
    const startAngle = -Math.PI / 2;
    let paths = '';
    colors.forEach((col, i) => {
      const a0 = startAngle + (i / n) * TAU;
      const a1 = startAngle + ((i + 1) / n) * TAU;
      const x0 = cx + r * Math.cos(a0), y0 = cy + r * Math.sin(a0);
      const x1 = cx + r * Math.cos(a1), y1 = cy + r * Math.sin(a1);
      const large = (a1 - a0) > Math.PI ? 1 : 0;
      paths += `<path d="M${cx},${cy} L${x0.toFixed(2)},${y0.toFixed(2)} A${r},${r} 0 ${large},1 ${x1.toFixed(2)},${y1.toFixed(2)} Z" fill="${col}"/>`;
    });
    innerSVG = paths + `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="white" stroke-width="1.5"/>`;
  }

  const shadow = `<circle cx="${cx+1}" cy="${cy+1}" r="${r+1}" fill="rgba(0,0,0,0.3)"/>`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
    ${shadow}${innerSVG}
  </svg>`;

  return L.divIcon({
    className: '',
    iconSize: [size, size],
    iconAnchor: [cx, cy],
    popupAnchor: [0, -cy - 2],
    html: svg
  });
}

function seekerPin(col='#e84040'){
  return L.divIcon({className:'', iconSize:[0,0], html:`
    <div style="position:relative;width:32px;height:32px;transform:translate(-16px,-16px)">
      <div style="position:absolute;inset:0;border-radius:50%;border:2px solid ${col};opacity:0.35;animation:pulse 1.5s ease-in-out infinite"></div>
      <div style="position:absolute;inset:7px;border-radius:50%;background:${col};border:2.5px solid white;box-shadow:0 2px 12px rgba(0,0,0,0.5)"></div>
      <div style="position:absolute;top:50%;left:0;right:0;height:1.5px;background:${col};opacity:0.7;transform:translateY(-50%)"></div>
      <div style="position:absolute;left:50%;top:0;bottom:0;width:1.5px;background:${col};opacity:0.7;transform:translateX(-50%)"></div>
    </div>`});
}

// Tentacle option — teardrop pin with number badge
function tentaclePin(num, col){
  return L.divIcon({className:'', iconSize:[0,0], html:`
    <div style="position:relative;transform:translate(-12px,-30px)">
      <svg width="24" height="32" viewBox="0 0 24 32" style="filter:drop-shadow(0 2px 4px rgba(0,0,0,0.5))">
        <path d="M12 0 C5.4 0 0 5.4 0 12 C0 20 12 32 12 32 C12 32 24 20 24 12 C24 5.4 18.6 0 12 0Z" fill="${col}"/>
        <circle cx="12" cy="11" r="8" fill="rgba(0,0,0,0.2)"/>
      </svg>
      <div style="position:absolute;top:4px;left:0;right:0;text-align:center;font-size:10px;font-weight:900;color:white;font-family:'Space Mono',monospace;line-height:14px;text-shadow:0 1px 2px rgba(0,0,0,0.4)">${num}</div>
    </div>`});
}

function getTentaclePreviewColor(index=0){
  const hue = (index * 137.508) % 360;
  return `hsl(${hue.toFixed(1)} 72% 48%)`;
}

function getTentaclePreviewColorMap(options=[]){
  const colorById = new Map();
  options.forEach((opt, i) => {
    const key = String(opt?.id || '').trim() || String(i);
    if(!colorById.has(key)) colorById.set(key, getTentaclePreviewColor(i));
  });
  return colorById;
}

function getTentacleDisplayOptions(question){
  const resolved = typeof getQuestionWithLocalContext === 'function'
    ? (getQuestionWithLocalContext(question) || question)
    : question;
  const source = resolved?.type === 'tentacles'
    ? resolved
    : {
        center: resolved?.center || qparams.center,
        radius_miles: resolved?.radius_miles || qparams.radius_miles || 1,
        options: resolved?.options || resolved?.tentacle_options || qparams.tentacle_options || [],
      };
  return typeof getTentacleOptionsInReach === 'function'
    ? getTentacleOptionsInReach(source)
    : (source.options || []).map((opt, i)=>normalizeTentacleOption(opt, i)).filter(Boolean);
}

function renderTentacleOptionPins(question, shouldFit=false){
  const q = question?.type === 'tentacles'
    ? question
    : {
        center: question?.center || qparams.center,
        radius_miles: question?.radius_miles || qparams.radius_miles || 1,
        options: question?.options || question?.tentacle_options || qparams.tentacle_options || [],
        id: question?.id || currentBuiltQuestion?.id || null,
      };
  const options = getTentacleDisplayOptions(q);
  const colorById = getTentaclePreviewColorMap(options);
  clearPoiMarkers();
  options.forEach((opt, i)=>{
    const key = String(opt?.id || '').trim() || String(i);
    const col = colorById.get(key) || getTentaclePreviewColor(i);
    const m = L.marker([opt.lat, opt.lng], {icon:tentaclePin(i + 1, col), zIndexOffset:1500 + i})
      .bindPopup(`<div class="stop-popup"><div class="stop-popup-name">${opt.name}</div></div>`, {offset:[0,-28], maxWidth:220})
      .on('click', ()=>handleTentaclePinTap(opt, i, q))
      .addTo(map);
    pickedMarkers.push(m);
  });
  if(shouldFit && options.length){
    const bounds = L.latLngBounds(options.map(opt => [opt.lat, opt.lng])).pad(0.3);
    map.fitBounds(bounds);
  }
  return options;
}

// Measure nearest result — teal diamond pin
function measurePin(){
  return L.divIcon({className:'', iconSize:[0,0], html:`
    <div style="transform:translate(-10px,-10px);width:20px;height:20px">
      <div style="width:14px;height:14px;background:#20c8b0;border:2.5px solid white;border-radius:3px;transform:rotate(45deg) translate(3px,3px);box-shadow:0 2px 8px rgba(0,0,0,0.5)"></div>
    </div>`});
}

// Hider location — glowing purple "eye" pin
function hiderPin(){
  return L.divIcon({className:'', iconSize:[0,0], html:`
    <div style="position:relative;width:36px;height:36px;transform:translate(-18px,-18px)">
      <div style="position:absolute;inset:0;border-radius:50%;background:rgba(160,96,255,0.2);animation:pulse 1.2s ease-in-out infinite"></div>
      <div style="position:absolute;inset:4px;border-radius:50%;border:2px solid rgba(160,96,255,0.5);animation:pulse 1.2s ease-in-out infinite 0.3s"></div>
      <div style="position:absolute;inset:9px;border-radius:50%;background:#a060ff;border:2.5px solid white;box-shadow:0 0 14px rgba(160,96,255,0.8)"></div>
    </div>`});
}

function amtrakLineColor(name){
  if(/downeaster/i.test(name)) return '#4aa3ff';
  if(/lake shore/i.test(name)) return '#a060ff';
  return '#20c8b0';
}

function amtrakLineLabel(name){
  if(/downeaster/i.test(name)) return 'Downeaster';
  if(/lake shore/i.test(name)) return 'Lake Shore';
  return 'NE Corridor';
}

function measureNearestPopup(categoryLabel, nearestName){
  const what = /line|coast|sea level|border|water/i.test(categoryLabel) ? 'nearest point' : 'nearest';
  return `<div class="stop-popup"><div class="stop-popup-name">${nearestName}</div><div style="font-size:9px;color:#f0a030">★ Your ${what} on ${categoryLabel}</div></div>`;
}

function isSeaLevelMeasure(label){
  return String(label || '').toLowerCase() === 'sea level';
}

function measureAnswerOptions(question){
  if(question?.type === 'measure' && question.mode === 'elevation'){
    return [
      {val:'higher', icon:'⬆️', label:'Higher', color:'#f0a030'},
      {val:'lower', icon:'⬇️', label:'Lower', color:'#3a8eff'},
    ];
  }
  return SIMUL_OPTS.measure;
}

function simplifyLineCoords(coords, tolerance=0.0035){
  if(!Array.isArray(coords) || coords.length < 3) return coords || [];
  const simplified = [coords[0]];
  let last = coords[0];
  for(let i = 1; i < coords.length - 1; i++){
    const point = coords[i];
    if(
      Math.abs(point[0] - last[0]) >= tolerance ||
      Math.abs(point[1] - last[1]) >= tolerance
    ){
      simplified.push(point);
      last = point;
    }
  }
  simplified.push(coords[coords.length - 1]);
  return simplified;
}

function coastlineLineFeaturesFromOverpass(data, fallbackName='Coastline'){
  const clipBox = [
    T_BBOX.minLng - 0.08,
    T_BBOX.minLat - 0.08,
    T_BBOX.maxLng + 0.08,
    T_BBOX.maxLat + 0.08,
  ];
  const coords = [];
  (data?.elements || [])
    .filter(el => el.type === 'way' && Array.isArray(el.geometry) && el.geometry.length >= 2)
    .forEach(el => {
      const line = simplifyLineCoords((el.geometry || []).map(p => [p.lon, p.lat]));
      if(line.length < 2) return;
      try{
        const clipped = turf.bboxClip(turf.lineString(line), clipBox);
        if(clipped?.geometry?.type === 'LineString' && clipped.geometry.coordinates.length >= 2){
          coords.push(simplifyLineCoords(clipped.geometry.coordinates));
        } else if(clipped?.geometry?.type === 'MultiLineString'){
          clipped.geometry.coordinates
            .filter(segment => Array.isArray(segment) && segment.length >= 2)
            .forEach(segment => coords.push(simplifyLineCoords(segment)));
        }
      }catch(e){}
    });
  if(!coords.length) return [];
  return [{
    name: fallbackName,
    geometry: {
      type: 'MultiLineString',
      coordinates: coords,
    },
  }];
}


function waterLineFeaturesFromOverpass(data, fallbackName='Water'){
  const byName = new Map();
  const addSegment = (name, segment) => {
    if(!Array.isArray(segment) || segment.length < 2) return;
    const line = simplifyLineCoords(segment, 0.00012);
    if(line.length < 2) return;
    const key = `${line[0][0].toFixed(4)},${line[0][1].toFixed(4)}|${line[line.length - 1][0].toFixed(4)},${line[line.length - 1][1].toFixed(4)}|${line.length}`;
    const group = byName.get(name) || {name, seen:new Set(), coords:[]};
    if(group.seen.has(key)) return;
    group.seen.add(key);
    group.coords.push(line);
    byName.set(name, group);
  };

  (data?.elements || []).forEach(el => {
    const name = el.tags?.name || fallbackName;
    if(el.type === 'way' && Array.isArray(el.geometry) && el.geometry.length >= 2){
      addSegment(name, el.geometry.map(p => [p.lon, p.lat]));
      return;
    }
    if(el.type === 'relation' && Array.isArray(el.members)){
      (el.members || []).forEach(member => {
        if(member.type !== 'way' || !Array.isArray(member.geometry) || member.geometry.length < 2) return;
        addSegment(name, member.geometry.map(p => [p.lon, p.lat]));
      });
    }
  });

  return [...byName.values()]
    .filter(group => group.coords.length)
    .map(group => ({
      name: group.name,
      bbox: featureBBox({
        geometry: {type:'MultiLineString', coordinates:group.coords},
      }),
      geometry: {type:'MultiLineString', coordinates:group.coords},
    }));
}

function normalizeMeasureLineFeatures(items){
  return (items || [])
    .map(item => {
      const feature = coerceFeature(item, item?.name);
      if(!feature) return null;
      return {
        name: item?.name || feature.properties?.name || 'Line',
        bbox: featureBBox(item),
        geometry: feature.geometry,
      };
    })
    .filter(Boolean);
}

function mergeMeasureLineFeatures(primary, extra){
  const merged = [];
  const seen = new Set();
  [...(primary || []), ...(extra || [])].forEach(item => {
    if(!item?.geometry) return;
    const bbox = featureBBox(item) || [];
    const geom = item.geometry;
    const key = `${item.name || ''}|${bbox.join(',')}|${geom.type}|${Array.isArray(geom.coordinates) ? geom.coordinates.length : 0}`;
    if(seen.has(key)) return;
    seen.add(key);
    merged.push(item);
  });
  return merged;
}

async function getMeasureLinearFeatures(catObj, center, opts={}){
  await loadPoiData();
  if(catObj.label === 'An Amtrak Line'){
    return getNamedLinearFeatures(catObj.label);
  }
  if(catObj.label === 'A Body of Water'){
    const preloaded = getNamedLinearFeatures(catObj.label);
    if(preloaded.length){
      if(opts.zone) return getWaterLineFeaturesForZone(opts.zone, opts.extraMiles || 0);
      return getWaterLineFeaturesNearCenter(center);
    }
    const r = 35000;
    const q = `[out:json][timeout:35];(
      way["natural"~"^(water|bay)$"]["name"](around:${r},${center.lat},${center.lng});
      relation["natural"~"^(water|bay)$"]["name"](around:${r},${center.lat},${center.lng});
      way["waterway"~"^(river|canal)$"]["name"](around:${r},${center.lat},${center.lng});
      way["waterway"="riverbank"]["name"](around:${r},${center.lat},${center.lng});
      relation["waterway"="riverbank"]["name"](around:${r},${center.lat},${center.lng});
    );out geom 500;`;
    const data = await overpassRaw(q);
    return waterLineFeaturesFromOverpass(data, 'Water');
  }
  if(catObj.label === 'A Coastline'){
    const preloaded = getNamedLinearFeatures(catObj.label);
    if(preloaded.length) return preloaded;
    const r = 50000;
    const q = `[out:json][timeout:25];way["natural"="coastline"](around:${r},${center.lat},${center.lng});out geom 300;`;
    const data = await overpassRaw(q);
    return coastlineLineFeaturesFromOverpass(data, 'Coastline');
  }
  return [];
}

async function resolveLinearMeasureCategory(catObj, center, opts={}){
  const nearestFeatures = normalizeMeasureLineFeatures(await getMeasureLinearFeatures(catObj, center, {purpose:'nearest'}));
  if(!nearestFeatures.length) return null;

  const nearestResult = await solveLinearMeasureWithWorker({
    center,
    categoryLabel: catObj.label,
    lineFeatures: nearestFeatures,
    buildConstraintUnion: false,
  });
  if(!nearestResult?.best) return null;

  let lineFeatures = nearestFeatures;
  let union = null;
  if(opts.buildConstraintUnion && opts.zone && Number.isFinite(nearestResult.best.dist)){
    let unionFeatures = nearestFeatures;
    if(catObj.label === 'A Body of Water'){
      const zoneFeatures = normalizeMeasureLineFeatures(await getMeasureLinearFeatures(catObj, center, {
        purpose: 'union',
        zone: opts.zone,
        extraMiles: nearestResult.best.dist,
      }));
      unionFeatures = mergeMeasureLineFeatures(zoneFeatures, nearestFeatures);
    }
    const unionResult = await solveLinearMeasureWithWorker({
      center,
      zone: opts.zone,
      seekerDist: nearestResult.best.dist,
      categoryLabel: catObj.label,
      lineFeatures: unionFeatures,
      buildConstraintUnion: true,
    });
    if(unionResult?.union) union = unionResult.union;
    lineFeatures = unionFeatures;
  }

  return {
    best: nearestResult.best,
    lineFeatures,
    union,
  };
}

function renderAmtrakMeasureLines(center, nearestName){
  const raw = Array.isArray(preloadedData.pois?.amtrakLines) ? preloadedData.pois.amtrakLines : [];
  if(!raw.length) return;
  const clipBox = [
    T_BBOX.minLng - 0.08,
    T_BBOX.minLat - 0.08,
    T_BBOX.maxLng + 0.08,
    T_BBOX.maxLat + 0.08,
  ];
  raw.forEach(item => {
    const feature = coerceFeature(item, item.name);
    if(!feature) return;
    let displayFeature = feature;
    try{
      const clipped = turf.bboxClip(feature, clipBox);
      if(clipped?.geometry?.coordinates?.length) displayFeature = clipped;
    }catch(e){}
    const name = item.name || feature.properties?.name || 'Amtrak';
    const active = name === nearestName;
    const color = amtrakLineColor(name);
    const lineLayer = L.geoJSON(displayFeature, {
      interactive: false,
      style: {
        color,
        weight: active ? 5 : 3,
        opacity: active ? 0.95 : 0.72,
      }
    }).addTo(map);
    pickedMarkers.push(lineLayer);

    const labelPts = pointsFromFeatureGeometry(displayFeature, name);
    if(!labelPts.length) return;
    labelPts.sort((a,b)=>turfDist(center,a)-turfDist(center,b));
    const anchor = labelPts[0];
    const label = L.tooltip({
      permanent: true,
      direction: 'center',
      className: `measure-line-label${active ? ' active' : ''}`,
      opacity: 1,
      offset: [0,0],
    })
      .setLatLng([anchor.lat, anchor.lng])
      .setContent(amtrakLineLabel(name))
      .addTo(map);
    pickedMarkers.push(label);
  });
}

async function selectMeasureCat(catObj){
  if(!qparams.center){toast('Set your location first');return;}
  qparams._mcat=catObj.label; qparams._mcatlabel=catObj.label; qparams._msearching=true;
  qparams.measure_cat=catObj.label; qparams.measure_cat_label=catObj.label;
  qparams.measure_mode='distance';
  qparams.measure_seeker_nearest=null; qparams.measure_seeker_dist=null; qparams.measure_seeker_elevation_ft=null; qparams.measure_seeker_elevation_m=null; qparams.measure_all_instances=null; qparams.measure_linear_features=null; qparams.measure_constraint_union=null;
  if(catObj.label==='A County Border') highlightBoundary('county');
  else if(catObj.label==='A City Border') highlightBoundary('city');
  else clearBoundaryHighlight();
  renderBuildBody();
  try{
    if(isSeaLevelMeasure(catObj.label)){
      const grid = await loadElevationData();
      if(!grid?.values?.length){
        toast('No elevation grid data available');
        qparams._msearching=false;
        renderBuildBody();
        return;
      }
      const elevation = await fetchPointElevation(qparams.center.lat, qparams.center.lng);
      qparams._msearching=false;
      qparams.measure_mode='elevation';
      qparams.measure_seeker_elevation_ft=elevation.feet;
      qparams.measure_seeker_elevation_m=elevation.meters;
      clearPoiMarkers();
      renderBuildBody(); updatePreview(); tryGenerate();
      return;
    }

    if(['An Amtrak Line','A Coastline','A Body of Water'].includes(catObj.label)){
      const resolved = await resolveLinearMeasureCategory(catObj, qparams.center, {
        zone: validZone,
        buildConstraintUnion: true,
      });
      if(!resolved?.lineFeatures?.length || !resolved.best){
        toast(`No ${catObj.label} geometry found`);
        qparams._msearching=false;
        renderBuildBody();
        return;
      }
      const {best, lineFeatures, union} = resolved;

      qparams._msearching=false;
      qparams.measure_seeker_nearest={lat:best.lat,lng:best.lng,name:best.name};
      qparams.measure_seeker_dist=best.dist;
      qparams.measure_linear_features=lineFeatures.map(item => ({
        name:item.name,
        bbox:item.bbox || null,
        geometry:item.geometry,
      }));
      qparams.measure_constraint_union=union || null;
      qparams.measure_all_instances=[{lat:best.lat,lng:best.lng,name:best.name}];

      clearPoiMarkers();
      if(catObj.label === 'An Amtrak Line'){
        renderAmtrakMeasureLines(qparams.center, best.name);
      }
      const m=L.marker([best.lat,best.lng],{icon:measurePin(),zIndexOffset:1500}).addTo(map);
      m.bindPopup(measureNearestPopup(catObj.label, best.name),{offset:[0,-12],maxWidth:220});
      pickedMarkers.push(m);
      const bounds = L.latLngBounds([[best.lat,best.lng],[qparams.center.lat,qparams.center.lng]]).pad(0.3);
      map.fitBounds(bounds);
      renderBuildBody(); updatePreview(); tryGenerate();
      return;
    }

    const instances = await getCategoryInstances(catObj, qparams.center, 35000);
    if(!instances.length){toast('No '+catObj.label+' found nearby');qparams._msearching=false;renderBuildBody();return;}

    // Find seeker's nearest
    instances.sort((a,b)=>turfDist(qparams.center,a)-turfDist(qparams.center,b));
    const nearest=instances[0];
    const dist=turfDist(qparams.center,nearest);

    qparams._msearching=false;
    qparams.measure_seeker_nearest={lat:nearest.lat,lng:nearest.lng,name:nearest.name};
    qparams.measure_seeker_dist=dist;
    qparams.measure_all_instances=instances.slice(0,200); // cap for zone geometry

    // Drop teardrop pins — gold #1 for nearest, teal for rest
    clearPoiMarkers();
    const POI_CATS_LINEAR = new Set(['An Amtrak Line','A County Border','A City Border','Sea Level','A Coastline','A Body of Water']);
    const isLinear = POI_CATS_LINEAR.has(catObj.label);
    if(isLinear){
      if(catObj.label === 'An Amtrak Line'){
        renderAmtrakMeasureLines(qparams.center, nearest.name);
      }
      // For linear/edge categories, show a single teal diamond at the nearest point
      const m=L.marker([nearest.lat,nearest.lng],{icon:measurePin(),zIndexOffset:1500}).addTo(map);
      m.bindPopup(measureNearestPopup(catObj.label, nearest.name),{offset:[0,-12],maxWidth:220});
      pickedMarkers.push(m);
    } else {
      // For POI categories, show numbered teardrop pins
      instances.slice(0,100).forEach((p,i)=>{
        if(!p.lat||!p.lng) return;
        const col = i===0 ? '#f0a030' : '#4a7090';
        const m = L.marker([p.lat,p.lng],{icon:tentaclePin(i+1,col),zIndexOffset:1500+i})
          .bindPopup(`<div class="stop-popup"><div class="stop-popup-name">${p.name}</div>${i===0?'<div style="font-size:9px;color:#f0a030;margin-top:2px">★ Your nearest</div>':''}</div>`,{offset:[0,-28],maxWidth:220})
          .addTo(map);
        pickedMarkers.push(m);
      });
    }
    // Fit map to show nearest + seeker location
    if(nearest.lat && nearest.lng){
      const bounds = L.latLngBounds([[nearest.lat,nearest.lng],[qparams.center.lat,qparams.center.lng]]).pad(0.3);
      map.fitBounds(bounds);
    }
    renderBuildBody(); updatePreview(); tryGenerate();
  }catch(e){qparams._msearching=false;toast('Search failed: '+e.message);renderBuildBody();}
}

async function selectTentacleCat(catObj){
  if(!qparams.center){toast('Set your location first');return;}
  qparams._tcat=catObj.label; qparams._tcatlabel=catObj.label; qparams._tsearching=true;
  _tentacleSelection = null;
  _simulActive = null;
  qparams.tentacle_options=null;
  clearPoiMarkers();
  renderBuildBody();
  try{
    const opts = await resolveTentacleQuestionOptions(catObj.label, qparams.center, qparams.radius_miles || 1);
    if(opts.length < 2){
      toast(`Found fewer than 2 ${catObj.label} nearby — try a larger radius`);
      qparams._tsearching=false; renderBuildBody(); return;
    }
    qparams._tsearching=false;
    qparams.tentacle_options=opts;
    renderTentacleOptionPins({
      center:qparams.center,
      radius_miles:qparams.radius_miles || 1,
      options:opts,
      id:currentBuiltQuestion?.id || null,
    }, true);
    renderBuildBody(); updatePreview(); tryGenerate();
  }catch(e){qparams._tsearching=false;toast('Search failed: '+e.message);renderBuildBody();}
}

async function resolveTentacleQuestionOptions(categoryLabel, center, radiusMiles=1){
  const catObj = TENTACLES_CATS.find(c => c.label === categoryLabel);
  if(!catObj) throw new Error(`Unknown tentacles category: ${categoryLabel}`);
  const reachMiles = Math.max(0, Number(radiusMiles || 1));
  const searchRadiusMiles = Math.round(reachMiles * 1.5 * 100) / 100; // search wider, but only keep true in-range options
  const searchRadiusM = Math.round(searchRadiusMiles * 1609.34);
  await loadPoiData();
  const preloaded = getNamedPoiCollection(catObj.label);
  let items = preloaded;
  if(items.length){
    items = items
      .filter(it => turfDist(center, it) <= searchRadiusMiles);
  } else {
    items = await overpassSearch(catObj.overpass(center, searchRadiusM), center, searchRadiusM);
  }
  items = items
    .filter(it => turfDist(center, it) <= reachMiles)
    .sort((a,b)=>turfDist({lat:a.lat,lng:a.lng},center)-turfDist({lat:b.lat,lng:b.lng},center));
  if(items.length < 2) return [];
  if(preloaded.length){
    return items.map((it, i) => normalizeTentacleOption(it, i)).filter(Boolean);
  }
  const labeled = await Promise.all(items.map(it=>shortLabel(it.name,it.lat,it.lng)));
  return items.map((it,i)=>normalizeTentacleOption({name:labeled[i], lat:it.lat, lng:it.lng}, i)).filter(Boolean);
}

function restartPick(){
  QDEFS[qtype].pickSteps.forEach(s=>delete qparams[s.key]);
  if(qtype === 'thermo') delete qparams.thermo_dest;
  clearMarkers();previewLayer.clearLayers();pickStep=0;
  document.getElementById('json-out-section').style.display='none';
  showBanner(pickStepDefs[0].label);
  document.getElementById('panel').classList.add('collapsed');
  renderBuildBody();
}

function updatePreview(){
  previewLayer.clearLayers();if(!qtype)return;
  try{
    if(qtype==='radar'&&qparams.center&&qparams.radius_miles) previewLayer.addData(makeCircle(qparams.center,qparams.radius_miles,'miles'));
    if(qtype==='thermo'){
      syncThermoHandleMarker();
      if(qparams.center&&qparams.travel_miles) previewLayer.addData(makeCircle(qparams.center,qparams.travel_miles,'miles'));
      if(qparams.center&&qparams.thermo_dest){
        previewLayer.addData(turf.lineString([
          [qparams.center.lng, qparams.center.lat],
          [qparams.thermo_dest.lng, qparams.thermo_dest.lat],
        ]));
        previewLayer.addData(thermoDividerLine(qparams.center, qparams.thermo_dest));
      }
    }
    if(qtype==='measure'&&qparams.measure_mode!=='elevation'){
      if(qparams.measure_constraint_union) previewLayer.addData(qparams.measure_constraint_union);
      else if(qparams.measure_seeker_nearest&&qparams.measure_seeker_dist) previewLayer.addData(makeCircle(qparams.measure_seeker_nearest,qparams.measure_seeker_dist,'miles'));
    }
    if(qtype==='tentacles'&&qparams.center&&qparams.radius_miles) previewLayer.addData(makeCircle(qparams.center,qparams.radius_miles,'miles'));
    if(qtype==='custom_boundary'&&qparams.custom_boundary_geojson) previewLayer.addData(qparams.custom_boundary_geojson);
  }catch(e){}
  if(previewLayer?.bringToFront) previewLayer.bringToFront();
  if(thermoHandleMarker?.bringToFront) thermoHandleMarker.bringToFront();
  refreshActiveAnswerPreview();
  if(typeof scheduleSaveGame === 'function') scheduleSaveGame();
}

function buildQuestionPacket(question){
  if(!question) return null;
  if(question.type === 'radar'){
    return {id:question.id, type:question.type, center:question.center, radius_miles:question.radius_miles};
  }
  if(question.type === 'thermo'){
    return {
      id:question.id,
      type:question.type,
      center:question.center,
      thermo_dest:question.thermo_dest,
      travel_miles:question.travel_miles,
    };
  }
  if(question.type === 'measure'){
    return {
      id:question.id,
      type:question.type,
      center:question.center,
      mode:question.mode || 'distance',
      category:question.category,
      category_label:question.category_label,
    };
  }
  if(question.type === 'tentacles'){
    const options = getTentacleDisplayOptions(question).map(opt => ({
      id: opt.id,
      name: opt.name,
      lat: opt.lat,
      lng: opt.lng,
    }));
    return {
      id:question.id,
      type:question.type,
      center:question.center,
      radius_miles:question.radius_miles || 1,
      category:question.category || question.category_label || null,
      category_label:question.category_label || question.category || null,
      options,
    };
  }
  if(question.type === 'matching'){
    return {
      id:question.id,
      type:question.type,
      center:question.center,
      category:question.category,
      category_label:question.category_label,
      ...(question.category === 'line'
        ? {
            seeker_val:question.seeker_val,
            line_id:question.line_id || null,
            hide_radius_miles:question.hide_radius_miles ?? hideRadiusMi,
          }
        : {}),
    };
  }
  if(question.type === 'nearest'){
    return {id:question.id, type:question.type, center:question.center, category:question.category, category_label:question.category_label};
  }
  if(question.type === 'photo'){
    return {id:question.id, type:question.type, prompt:question.prompt};
  }
  return cloneForStorage(question);
}

function generateJSON(){
  const activeType = getActiveBuildQType();
  const def=QDEFS[activeType];
  _tentacleSelection = null;
  if(currentBuiltQuestion?.id) forgetOutgoingQuestion(currentBuiltQuestion.id);
  const fullQuestion=def.toJSON(qparams);
  fullQuestion.id='q'+Date.now().toString(36);
  currentBuiltQuestion = {
    ...fullQuestion,
    _constraint_union: fullQuestion.type === 'measure' ? qparams.measure_constraint_union || null : null,
  };
  rememberOutgoingQuestion(currentBuiltQuestion);
  saveGame();
  const json = buildQuestionPacket(currentBuiltQuestion);
  // Yield to UI thread before heavy stringify (prevents freeze on mobile)
  setTimeout(()=>{
    document.getElementById('json-out').value=JSON.stringify(json,null,2);
    document.getElementById('json-out-section').style.display='block';
    if(currentBuiltQuestion?.type === 'tentacles') renderTentacleOptionPins(currentBuiltQuestion);
    updatePreview();
    renderSimulBtns(json);
    renderDirectApplyBtns(json);
  },0);
}

function ensureMeasureConstraint(question){
  if(!question || question.type !== 'measure' || question._constraint_union) return question;
  const union = buildMeasureConstraintUnion(question, validZone);
  if(!union) return question;
  question._constraint_union = union;
  if(currentBuiltQuestion && currentBuiltQuestion.id === question.id){
    currentBuiltQuestion._constraint_union = union;
  }
  return question;
}

function shouldWarnSlowMeasure(question){
  return !!(
    question &&
    question.type === 'measure' &&
    !question._constraint_union &&
    /coast/i.test(question.category_label || question.category || '')
  );
}

function runSlowMeasureAction(question, work){
  if(!shouldWarnSlowMeasure(question)){
    work();
    return;
  }
  toast('Coastline measure can take a bit the first time');
  setTimeout(work, 0);
}

// ── per-type answer option definitions ──
const SIMUL_OPTS = {
  radar:    [{val:'yes',    icon:'✅', label:'Within',    color:'#18b050'}, {val:'no',      icon:'❌', label:'Outside',  color:'#e84040'}],
  thermo:   [{val:'closer', icon:'🔥', label:'Closer',    color:'#f0a030'}, {val:'further', icon:'❄️', label:'Further',  color:'#3a8eff'}],
  measure:  [{val:'closer', icon:'🔥', label:'Closer',    color:'#f0a030'}, {val:'further', icon:'❄️', label:'Further',  color:'#3a8eff'}],
  matching: [{val:'Yes', icon:'✅', label:'Yes — same', color:'#18b050'}, {val:'No', icon:'❌', label:'No — different', color:'#e84040'}],
  nearest:  [{val:'Yes', icon:'✅', label:'Yes — same', color:'#18b050'}, {val:'No', icon:'❌', label:'No — different', color:'#e84040'}],
  tentacles:[{val:'no',     icon:'❌', label:'Not nearby',color:'#e84040'}],
};

let _simulActive = null; // currently previewed answer val
let _tentacleSelection = null; // {mode:'preview'|'apply', questionId:string}

function getQuestionWithLocalContext(question){
  if(!question) return null;
  if(question.type === 'measure' && !question._constraint_union){
    const local = question.id
      ? ((currentBuiltQuestion && currentBuiltQuestion.id === question.id)
          ? currentBuiltQuestion
          : getOutgoingQuestion(question.id))
      : null;
    if(local?.type === 'measure' && local._constraint_union){
      return {...question, _constraint_union: local._constraint_union};
    }
    if(
      currentBuiltQuestion?.type === 'measure' &&
      currentBuiltQuestion.id === question.id &&
      qparams.measure_constraint_union
    ){
      return {...question, _constraint_union: qparams.measure_constraint_union};
    }
  }
  if(question.type === 'tentacles' && (!Array.isArray(question.options) || question.options.length < 2) && question.id){
    const local = (currentBuiltQuestion && currentBuiltQuestion.id === question.id)
      ? currentBuiltQuestion
      : getOutgoingQuestion(question.id);
    if(local?.type === 'tentacles' && Array.isArray(local.options) && local.options.length >= 2){
      return local;
    }
  }
  return question;
}

function getTentacleSelectionQuestion(question){
  const q = getQuestionWithLocalContext(question || getLivePreviewQuestion() || currentBuiltQuestion);
  return q?.type === 'tentacles' ? q : null;
}

function isTentacleSelectionActive(question){
  const q = getTentacleSelectionQuestion(question);
  return !!(q && _tentacleSelection && _tentacleSelection.questionId === q.id);
}

function tentacleSelectionPrompt(mode){
  return mode === 'apply'
    ? 'Tap a tentacle pin on the map to apply locally, or cancel.'
    : 'Tap a tentacle pin on the map to preview, or cancel.';
}

function updateTentacleSelectionPanels(question){
  const q = getTentacleSelectionQuestion(question);
  if(!q) return;
  renderSimulBtns(q);
  renderDirectApplyBtns(q);
}

function startTentacleSelection(mode, question){
  const q = getTentacleSelectionQuestion(question);
  if(!q){ toast('Generate a tentacles question first'); return; }
  _tentacleSelection = {mode, questionId:q.id};
  updateTentacleSelectionPanels(q);
  renderTentacleRegionsPreview(q);
}

function cancelTentacleSelection(question){
  const q = getTentacleSelectionQuestion(question);
  _tentacleSelection = null;
  _simulActive = null;
  clearZonePreview();
  updatePreview();
  if(q) updateTentacleSelectionPanels(q);
}

function handleTentaclePinTap(option, index, question){
  const q = getTentacleSelectionQuestion(question);
  if(!isTentacleSelectionActive(q)) return;
  const pending = _tentacleSelection;
  const val = option.id || buildTentacleOptionId(option, index);
  _tentacleSelection = null;
  updateTentacleSelectionPanels(q);
  if(pending.mode === 'apply') applyBuiltAnswer(val);
  else previewAnswer(val);
}

function getLocalApplyOptions(json){
  const question = getQuestionWithLocalContext(json);
  if(!question) return [];
  if(question.type === 'measure') return measureAnswerOptions(question);
  if(question.type === 'tentacles'){
    const opts = [{val:'no', icon:'❌', label:'Not nearby', color:'#e84040'}];
    (question.options || []).forEach((opt, i) => {
      opts.push({
        val: opt.id || buildTentacleOptionId(opt, i),
        icon: String(i + 1),
        label: opt.name,
        color: '#20c8b0',
      });
    });
    return opts;
  }
  if(SIMUL_OPTS[question.type]) return SIMUL_OPTS[question.type];
  if(question.type === 'photo'){
    return [{val:'sent', icon:'📸', label:'Photo sent', color:'#18b050'}];
  }
  return (question.answer_opts || []).map(val => ({
    val,
    icon:'•',
    label:String(val),
    color:'#20c8b0',
  }));
}

function renderDirectApplyBtns(json){
  const container = document.getElementById('direct-apply-btns');
  if(!container) return;
  const question = getQuestionWithLocalContext(json);
  if(question?.type === 'tentacles'){
    const active = isTentacleSelectionActive(question);
    container.innerHTML = active
      ? `<div class="simul-select-wrap tentacle-preview-tools">
           <div class="found-result" style="margin-bottom:8px">🐙 ${tentacleSelectionPrompt(_tentacleSelection.mode)}</div>
           <button class="simul-clear-btn" type="button" onclick="${_c(()=>cancelTentacleSelection(question))}">Cancel</button>
         </div>`
      : `<div class="simul-select-wrap tentacle-preview-tools">
           <button class="simul-clear-btn tentacle-preview-btn" type="button" onclick="${_c(()=>startTentacleSelection('apply', question))}">Apply Locally</button>
         </div>`;
    return;
  }
  const opts = getLocalApplyOptions(question);
  if(!opts.length){
    container.innerHTML = '';
    return;
  }
  container.innerHTML = opts.map(o =>
    `<button class="simul-btn" style="--simul-col:${o.color}" onclick="${_c(()=>applyBuiltAnswer(o.val))}">
      <span class="s-icon">${o.icon}</span>${o.label}
    </button>`
  ).join('');
}

function setPreviewMapMode(active){
  if(maskLayer?.setStyle){
    maskLayer.setStyle({
      color:'transparent',
      weight:0,
      fillColor:'#cc1010',
      fillOpacity: active ? 0.16 : 0.42,
    });
  }
  if(borderLayer?.setStyle){
    borderLayer.setStyle(active ? {
      color:'#7fd99b',
      weight:2,
      fillColor:'#7fd99b',
      fillOpacity:0.04,
      dashArray:'4 4',
    } : {
      color:'#18b050',
      weight:3,
      fillColor:'#18b050',
      fillOpacity:0.10,
      dashArray:'7 4',
    });
  }
}

function clearZonePreview(){
  if(tentaclePreviewLayer) tentaclePreviewLayer.clearLayers();
  simulLayer.clearLayers();
  simulMaskLayer.clearLayers();
  setPreviewMapMode(false);
}

function renderZonePreviewResult(result, label, color, shouldFit=true, answeredQuestion=null){
  if(!result) return;
  const hint = document.getElementById('simul-hint');
  const previewQuestion = answeredQuestion || getLivePreviewQuestion() || currentBuiltQuestion;
  const previewState = previewQuestion ? deriveStopRegionStateFromConstraints([...constraints, previewQuestion]) : null;
  const hard = previewState?.hardUnion || result;
  const greenFeatures = previewState?.greenFeatures || geometryToPolygonFeatures(hard, {regionKind:'green'});
  const yellowFeatures = previewState?.yellowFeatures || [];
  const eliminated = exactDiff(validZone, hard);
  setPreviewMapMode(true);
  if(tentaclePreviewLayer) tentaclePreviewLayer.clearLayers();
  simulLayer.clearLayers();
  simulMaskLayer.clearLayers();
  simulLayer.options.style = {
    color: '#4fe07c', weight: 3, fillColor: '#37c96b', fillOpacity: 0.30, interactive: false
  };
  simulMaskLayer.options.style = {
    color: '#ff6b6b', weight: 2, fillColor: '#ff5a5a', fillOpacity: 0.30, interactive: false
  };
  if(greenFeatures.length) simulLayer.addData(turf.featureCollection(greenFeatures));
  else simulLayer.addData(hard);
  if(yellowFeatures.length && tentaclePreviewLayer){
    tentaclePreviewLayer.addData({
      type:'FeatureCollection',
      features:yellowFeatures.map(feature => ({
        ...cloneGeo(feature),
        properties:{
          ...(feature.properties || {}),
          color:'#f0a030',
          strokeColor:'#f0a030',
          fillColor:'#f0a030',
          fillOpacity:0.24,
          weight:2,
          opacity:0.95,
          dashArray:'6 4',
        },
      })),
    });
  }
  if(eliminated) simulMaskLayer.addData(eliminated);
  if(shouldFit){
    try{ map.fitBounds(L.geoJSON(hard).getBounds().pad(0.12)); }catch(e){}
  }
  const area = (turf.area(hard)/1e6).toFixed(1);
  const pctRemain = validZone ? Math.round(turf.area(hard)/turf.area(validZone)*100) : '?';
  const pctElim = typeof pctRemain === 'number' ? 100 - pctRemain : '?';
  if(hint){
    hint.innerHTML = `<b>${label}:</b> ${area} km² remain <span style="color:${color}">(${pctElim}% eliminated)</span><br><span style="font-size:8px;color:var(--dim)">Green stays in play. Red is eliminated by this answer.</span>`;
    hint.className = 'simul-result-hint visible';
    hint.innerHTML = `<b>${label}:</b> ${area} km² remain <span style="color:${color}">(${pctElim}% eliminated)</span><br><span style="font-size:8px;color:var(--dim)">Green is possible now. Yellow is temporary. Red is fully eliminated.</span>`;
  }
  const msb = document.getElementById('msb-area');
  if(msb) msb.innerHTML = `<b style="color:var(--green)">${pctRemain}%</b> stays · <b style="color:#e84040">${pctElim}%</b> cut`;
  if(msb) msb.innerHTML = `<b style="color:var(--green)">green</b> stays · <b style="color:var(--gold)">yellow</b> temporary · <b style="color:#e84040">red</b> cut`;
  if(previewQuestion?.type === 'tentacles') document.getElementById('map-simul-bar').classList.remove('visible');
  else document.getElementById('map-simul-bar').classList.add('visible');
}

function getLivePreviewQuestion(){
  const activeType = getActiveBuildQType();
  if(currentBuiltQuestion && currentBuiltQuestion.type === activeType) return currentBuiltQuestion;
  if(!qtype || !QDEFS[activeType] || !QDEFS[activeType].isReady(qparams)) return null;
  try{
    return {
      ...QDEFS[activeType].toJSON(qparams),
      _constraint_union: activeType === 'measure' ? qparams.measure_constraint_union || null : null,
    };
  }catch(e){
    return null;
  }
}

function renderTentacleRegionsPreview(question){
  const q = getQuestionWithLocalContext(question) || getQuestionWithLocalContext(getLivePreviewQuestion()) || currentBuiltQuestion;
  if(!q || q.type !== 'tentacles'){
    toast('Generate a tentacles question first');
    return;
  }
  const options = getTentacleDisplayOptions(q);
  const colorById = getTentaclePreviewColorMap(options);
  const {circle, regions} = buildTentacleRegions(q, validZone);
  if(!circle){
    toast('Could not build tentacles preview');
    return;
  }
  clearZonePreview();
  if(tentaclePreviewLayer) tentaclePreviewLayer.clearLayers();
  tentaclePreviewLayer.addData({
    type:'Feature',
    properties:{
      color:'#20c8b0',
      strokeColor:'#20c8b0',
      fillColor:'#20c8b0',
      fillOpacity:0.04,
      weight:2,
      dashArray:'6 4',
      opacity:0.9,
    },
    geometry: circle.geometry,
  });
  tentaclePreviewLayer.addData({
    type:'FeatureCollection',
    features: regions.map((item, i) => {
      const key = String(item?.option?.id || '').trim() || String(item?.index ?? i);
      const col = colorById.get(key) || getTentaclePreviewColor(item?.index ?? i);
      return {
        ...cloneGeo(item.region),
        properties:{
          color: col,
          strokeColor: col,
          fillColor: col,
          fillOpacity:0.18,
          weight:2,
          opacity:0.95,
        },
      };
    }),
  });
  setPreviewMapMode(true);
  const hint = document.getElementById('simul-hint');
  if(hint){
    hint.innerHTML = `<b>Preview Regions:</b> inside the ${q.radius_miles || 1} mile circle, each colored region matches the nearest tentacle pin.<br><span style="font-size:8px;color:var(--dim)">Tap a pin on the map to preview or apply, or cancel to return.</span>`;
    hint.className = 'simul-result-hint visible';
  }
  const msb = document.getElementById('msb-area');
  if(msb) msb.innerHTML = 'tap a tentacle pin on the map';
  document.getElementById('map-simul-bar').classList.remove('visible');
}

function previewTentacleRegions(){
  startTentacleSelection('preview', getLivePreviewQuestion() || currentBuiltQuestion);
}

function refreshActiveAnswerPreview(){
  if(!_simulActive || !qtype) return;
  const liveQ = getQuestionWithLocalContext(getLivePreviewQuestion());
  const def = liveQ ? QDEFS[liveQ.type] : QDEFS[getActiveBuildQType()];
  const opts = getLocalApplyOptions(liveQ);
  if(!def || !opts) return;
  const opt = opts.find(o=>o.val===_simulActive);
  if(!opt) return;
  if(!liveQ) return;
  try{
    ensureMeasureConstraint(liveQ);
    const q = {...liveQ, answer:_simulActive, answer_label: opt.label};
    const result = def.applyToZone(validZone, q);
    if(!result) return;
    renderZonePreviewResult(result, `${opt.icon} ${opt.label}`, opt.color, false, q);
  }catch(e){}
}

function escapePreviewOptionLabel(text){
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderSimulBtns(json){
  const question = getQuestionWithLocalContext(json);
  const opts = getLocalApplyOptions(question);
  const container = document.getElementById('simul-btns');
  const hint      = document.getElementById('simul-hint');
  const bar       = document.getElementById('map-simul-bar');
  const msbBtns   = document.getElementById('msb-btns');
  const msbArea   = document.getElementById('msb-area');
  const preserved = question?.type === 'tentacles'
    ? null
    : (opts.some(o=>o.val===_simulActive) ? _simulActive : null);
  _simulActive = preserved;
  clearZonePreview();
  updatePreview();
  if(hint){
    hint.className = 'simul-result-hint';
    hint.innerHTML = '';
  }
  if(!opts.length){
    container.innerHTML='';
    msbBtns.innerHTML='';
    bar.classList.remove('visible');
    if(msbArea) msbArea.innerHTML = 'green stays · red goes';
    return;
  }
  if(question?.type === 'tentacles'){
    const active = isTentacleSelectionActive(question);
    container.innerHTML = active
      ? `
      <div class="simul-select-wrap tentacle-preview-tools">
        <div class="found-result" style="margin-bottom:8px">🐙 ${tentacleSelectionPrompt(_tentacleSelection.mode)}</div>
        <button class="simul-clear-btn" type="button" onclick="${_c(()=>cancelTentacleSelection(question))}">Cancel</button>
      </div>
    `
      : `
      <div class="simul-select-wrap tentacle-preview-tools">
        <button class="simul-clear-btn tentacle-preview-btn" type="button" onclick="${_c(()=>startTentacleSelection('preview', question))}">Preview Regions</button>
        <button class="simul-clear-btn tentacle-preview-btn" type="button" onclick="${_c(()=>startTentacleSelection('apply', question))}">Apply Locally</button>
      </div>
    `;
    msbBtns.innerHTML = '';
    bar.classList.remove('visible');
    if(msbArea) msbArea.innerHTML = active ? tentacleSelectionPrompt(_tentacleSelection.mode) : 'choose Preview Regions or Apply Locally';
    return;
  }
  // Panel buttons
  container.innerHTML = opts.map(o =>
    `<button class="simul-btn" id="sb-${o.val}"
       style="--simul-col:${o.color}"
       onclick="previewAnswer('${o.val}')">
       <span class="s-icon">${o.icon}</span>${o.label}
     </button>`
  ).join('');
  // Map bar buttons
  msbBtns.innerHTML = opts.map(o =>
    `<button class="msb-btn" id="msb-${o.val}"
       style="--msb-col:${o.color}"
       onclick="previewAnswer('${o.val}')">
       ${o.icon} ${o.label}
     </button>`
  ).join('');
  bar.classList.add('visible');
  if(_simulActive){
    const btn  = document.getElementById(`sb-${_simulActive}`);
    const mbtn = document.getElementById(`msb-${_simulActive}`);
    if(btn) btn.classList.add('active');
    if(mbtn) mbtn.classList.add('active');
    refreshActiveAnswerPreview();
  } else {
    if(msbArea) msbArea.innerHTML = 'green stays · red goes';
  }
}

function previewAnswer(val){
  const baseQuestion = getQuestionWithLocalContext(getLivePreviewQuestion() || currentBuiltQuestion);
  const def = baseQuestion ? QDEFS[baseQuestion.type] : QDEFS[getActiveBuildQType()];
  const opts = getLocalApplyOptions(baseQuestion);
  const hint = document.getElementById('simul-hint');
  const msbArea = document.getElementById('msb-area');

  if(!val){
    _simulActive = null;
    clearZonePreview();
    updatePreview();
    document.querySelectorAll('.simul-btn,.msb-btn').forEach(b=>b.classList.remove('active'));
    if(baseQuestion?.type === 'tentacles') _tentacleSelection = null;
    if(hint){
      hint.className = 'simul-result-hint';
      hint.innerHTML = '';
    }
    if(msbArea) msbArea.innerHTML = baseQuestion?.type === 'tentacles'
      ? 'tap a tentacle pin on the map'
      : 'green stays · red goes';
    return;
  }

  // Toggle off if same button pressed twice
  if(_simulActive === val){
    _simulActive = null;
    clearZonePreview();
    updatePreview();
    document.querySelectorAll('.simul-btn,.msb-btn').forEach(b=>b.classList.remove('active'));
    if(baseQuestion?.type === 'tentacles') _tentacleSelection = null;
    if(hint){
      hint.className = 'simul-result-hint';
      hint.innerHTML = '';
    }
    if(msbArea) msbArea.innerHTML = baseQuestion?.type === 'tentacles'
      ? 'tap a tentacle pin on the map'
      : 'green stays · red goes';
    return;
  }

  _simulActive = val;
  document.querySelectorAll('.simul-btn,.msb-btn').forEach(b=>b.classList.remove('active'));
  const btn  = document.getElementById(`sb-${val}`);
  const mbtn = document.getElementById(`msb-${val}`);
  if(btn)  btn.classList.add('active');
  if(mbtn) mbtn.classList.add('active');

  const opt = opts.find(o=>o.val===val);
  const col = opt ? opt.color : '#20c8b0';

  try {
    const liveQ = getQuestionWithLocalContext(getLivePreviewQuestion());
    const baseQ = liveQ || getQuestionWithLocalContext(JSON.parse(document.getElementById('json-out').value));
    runSlowMeasureAction(baseQ, () => {
      try{
        ensureMeasureConstraint(baseQ);
        const q = opt ? {...baseQ, answer: val, answer_label: opt.label} : {...baseQ, answer: val};
        const result = def.applyToZone(validZone, q);
        if(!result){ toast('Nothing left in zone for this answer'); return; }
        renderZonePreviewResult(result, opt ? `${opt.icon} ${opt.label}` : val, col, true, q);
      }catch(e){
        toast('Preview error: '+e.message);
      }
    });
  } catch(e) {
    toast('Preview error: '+e.message);
  }
}

function applyBuiltAnswer(val){
  const raw = document.getElementById('json-out').value.trim();
  if(!raw){ toast('Generate a question first'); return; }
  try{
    const parsed = JSON.parse(raw);
    const base = currentBuiltQuestion && currentBuiltQuestion.id === parsed.id
      ? currentBuiltQuestion
      : getOutgoingQuestion(parsed.id);
    const opt = getLocalApplyOptions(base || parsed).find(o => o.val === val);
    const q = base
      ? {...base, answer: val, ...(opt ? {answer_label: opt.label} : {})}
      : {...parsed, answer: val, ...(opt ? {answer_label: opt.label} : {})};
    runSlowMeasureAction(q, () => {
      try{
        ensureMeasureConstraint(q);
        applyAnswerObject(q, ()=>{
          resetBuild();
          switchTab('log');
        });
      }catch(e){
        toast('Could not apply built answer');
      }
    });
  }catch(e){
    toast('Could not apply built answer');
  }
}

function previewCustomBoundary(mode){
  const poly = qparams.custom_boundary_geojson || buildCustomBoundaryFeature(qparams.custom_boundary_points || []);
  if(!poly){ toast('Draw at least 3 points first'); return; }
  qparams.custom_boundary_geojson = poly;
  qparams.custom_boundary_mode = mode;
  qparams._drawingBoundary = false;
  hideBanner();
  const q = {type:'custom_boundary', boundary_geojson: poly, mode};
  const result = QDEFS.custom_boundary.applyToZone(validZone, q);
  if(!result){ toast('Nothing left in zone for this boundary'); return; }
  renderZonePreviewResult(result, mode === 'include' ? '✅ Include' : '❌ Exclude', mode === 'include' ? '#18b050' : '#e84040');
}

function applyCustomBoundary(){
  const poly = qparams.custom_boundary_geojson || buildCustomBoundaryFeature(qparams.custom_boundary_points || []);
  if(!poly){ toast('Draw at least 3 points first'); return; }
  if(!qparams.custom_boundary_mode){ toast('Choose include or exclude first'); return; }
  qparams._drawingBoundary = false;
  hideBanner();
  const q = {
    type:'custom_boundary',
    boundary_geojson: poly,
    mode: qparams.custom_boundary_mode,
  };
  const nz = QDEFS.custom_boundary.applyToZone(validZone, q);
  if(!nz){ toast('Zone empty — contradiction?'); return; }
  validZone = nz;
  constraints.push(q);
  syncZoneStateFromConstraints();
  renderZone();
  renderLog();
  saveGame();
  toast(`Custom boundary ${q.mode === 'include' ? 'included' : 'excluded'} ✓`);
  clearCustomBoundary();
  switchTab('log');
}

function copyQ(){
  navigator.clipboard.writeText(document.getElementById('json-out').value).then(()=>{
    const fl=document.getElementById('cf');fl.classList.add('on');setTimeout(()=>fl.classList.remove('on'),2200);
    toast('Copied! Send to your friend.');
  }).catch(()=>toast('Tap the text area and copy manually'));
}

function resetBuild(){
  qtype=null;qparams={};pickStep=-1;pickStepDefs=[];
  currentBuiltQuestion = null;
  _tentacleSelection = null;
  clearMarkers();previewLayer.clearLayers();clearZonePreview();hideBanner();
  clearBoundaryHighlight();
  _simulActive=null;
  document.querySelectorAll('.qbtn').forEach(b=>b.classList.remove('on'));
  document.getElementById('json-out-section').style.display='none';
  document.getElementById('map-simul-bar').classList.remove('visible');
  if(typeof setLoadQuestionPanelOpen === 'function') setLoadQuestionPanelOpen(false);
  const direct = document.getElementById('direct-apply-btns');
  if(direct) direct.innerHTML = '';
  renderBuildBody();
  if(typeof scheduleSaveGame === 'function') scheduleSaveGame();
}
