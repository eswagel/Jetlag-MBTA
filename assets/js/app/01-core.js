// ══════════════════════════════════════════════════════
//  GAME LINE DEFINITIONS
// ══════════════════════════════════════════════════════
// Red has one route ID ("Red") but two branches distinguished by route patterns.
// All other lines map 1:1 to a route ID.
const GAME_LINES = [
  { id:'Red-Ashmont',   label:'Red · Ashmont',    color:'#DA291C', weight:5, routeId:'Red',     branchKeyword:'Ashmont'   },
  { id:'Red-Braintree', label:'Red · Braintree',   color:'#DA291C', weight:5, routeId:'Red',     branchKeyword:'Braintree' },
  { id:'Orange',        label:'Orange Line',        color:'#ED8B00', weight:5, routeId:'Orange'   },
  { id:'Blue',          label:'Blue Line',          color:'#003DA5', weight:5, routeId:'Blue'     },
  { id:'Green-B',       label:'Green Line · B',     color:'#00843D', weight:4, routeId:'Green-B'  },
  { id:'Green-C',       label:'Green Line · C',     color:'#00843D', weight:4, routeId:'Green-C'  },
  { id:'Green-D',       label:'Green Line · D',     color:'#00843D', weight:4, routeId:'Green-D'  },
  { id:'Green-E',       label:'Green Line · E',     color:'#00843D', weight:4, routeId:'Green-E'  },
  { id:'Mattapan',      label:'Mattapan Line',       color:'#DA291C', weight:4, routeId:'Mattapan' },
];

// stopId → { name, lat, lng, lines: Set<lineId> }
const stopLineMap = {};

// ══════════════════════════════════════════════════════
//  CONSTANTS & STATE
// ══════════════════════════════════════════════════════
const CENTER = [42.3601,-71.0589];
const S = 41.85, N = 42.80, W = -71.70, E = -70.40;
const T_BBOX = {minLat:42.18, maxLat:42.67, minLng:-71.55, maxLng:-70.85};
const DATA_FILES = {
  mbta: 'data/mbta-data.json',
  pois: 'data/pois.json',
  boundaries: 'data/boundaries.json',
  landmasses: 'data/landmasses.json',
};
const INIT_POLY = turf.polygon([[
  [-71.70,41.85],[-70.40,41.85],[-70.40,42.80],[-71.70,42.80],[-71.70,41.85]
]]);

let map, maskLayer, borderLayer, radiusLayer, previewLayer, simulLayer, simulMaskLayer, pickedMarkers=[];
let townLayer, countyLayer, boundaryHighlightLayer;
const commuterRailStops = new Set();
const commuterRailStopsList = [];
let seekerPinMarkers = []; // seeker location dots — preserved across POI category changes
let validZone = cloneGeo(INIT_POLY);
let constraints = [];
let qtype=null, qparams={}, pickStep=-1, pickStepDefs=[];
let hideRadiusMi = 0.25;   // set by setup screen
let mbdataReady  = false;  // true once MBTA API load completes
let gameMode = 'seeker';   // 'seeker' | 'hider' | 'dev'
let hiderStation = null;   // {name, lat, lng, lines:[...]} set when hider taps their station
let _pickingHiderStation = false;
const preloadedData = {
  mbta: null,
  pois: null,
  boundaries: null,
  landmasses: null,
};

// ══════════════════════════════════════════════════════
//  GAME MODE
// ══════════════════════════════════════════════════════
function selectMode(el){
  document.querySelectorAll('.mode-card').forEach(c=>c.classList.remove('selected'));
  el.classList.add('selected');
  gameMode = el.dataset.mode;
}

function applyGameMode(){
  const badge = document.getElementById('mode-badge');

  // Tab visibility config per mode
  const MODES = {
    seeker: { tabs: ['build','boundary','log'], default: 'build',  badge: '🔭 Seeker',  cls: 'seeker' },
    hider:  { tabs: ['hider'],               default: 'hider',   badge: '🫣 Hider',   cls: 'hider'  },
    dev:    { tabs: ['build','boundary','hider','log'], default: 'build', badge: '🛠 Dev', cls: 'dev'    },
  };
  const cfg = MODES[gameMode] || MODES.dev;

  // Show/hide tab buttons
  document.querySelectorAll('.tab[data-tab]').forEach(t=>{
    t.style.display = cfg.tabs.includes(t.dataset.tab) ? '' : 'none';
  });

  // Show/hide panes
  document.querySelectorAll('.tab-pane').forEach(p=>{
    const tabId = p.id.replace('tab-','');
    p.style.display = cfg.tabs.includes(tabId) ? (tabId === cfg.default ? 'block' : 'none') : 'none';
  });

  // Sync active tab highlight
  document.querySelectorAll('.tab').forEach(t=>t.classList.toggle('active', t.dataset.tab===cfg.default));

  // Show mode badge
  badge.textContent = cfg.badge;
  badge.className = cfg.cls;
  badge.style.display = 'inline-block';

  // Hider mode: keep panel open and taller
  if(gameMode === 'hider'){
    document.getElementById('panel').classList.remove('collapsed');
    document.getElementById('tab-hider').classList.add('hider-mode-fullscreen');
  } else {
    document.getElementById('tab-hider').classList.remove('hider-mode-fullscreen');
  }
}
const SAVE_KEY = 'jetlag_mbta_save';

function saveGame(){
  try{
    const save = {
      v: 1,
      ts: Date.now(),
      gameMode,
      hideRadiusMi,
      hiderStation: hiderStation || null,
      validZone: cloneGeo(validZone),
      constraints: constraints.map(c => JSON.parse(JSON.stringify(c, (k,v)=>v instanceof Set?[...v]:v)))
    };
    localStorage.setItem(SAVE_KEY, JSON.stringify(save));
  }catch(e){ console.warn('Save failed', e); }
}

function loadSave(){
  try{
    const raw = localStorage.getItem(SAVE_KEY);
    if(!raw) return null;
    const save = JSON.parse(raw);
    if(!save.v || !save.constraints || !save.validZone) return null;
    return save;
  }catch(e){ return null; }
}

function clearSave(){
  localStorage.removeItem(SAVE_KEY);
}

async function fetchOptionalJSON(path, label){
  try{
    const res = await fetch(path, {cache:'no-store'});
    if(!res.ok) return null;
    const data = await res.json();
    console.log(`Loaded ${label} from ${path}`);
    return data;
  }catch(e){
    console.warn(`Optional ${label} load failed:`, e);
    return null;
  }
}

async function loadPoiData(){
  if(preloadedData.pois) return preloadedData.pois;
  preloadedData.pois = await fetchOptionalJSON(DATA_FILES.pois, 'POIs');
  return preloadedData.pois;
}

async function loadBoundaryData(){
  if(preloadedData.boundaries) return preloadedData.boundaries;
  preloadedData.boundaries = await fetchOptionalJSON(DATA_FILES.boundaries, 'boundaries');
  return preloadedData.boundaries;
}

function normKey(value){
  return String(value || '')
    .toLowerCase()
    .replace(/\bcounty\b/g, '')
    .replace(/\b(city|town)\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function deepClone(value){
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function coerceFeature(item, name){
  if(!item) return null;
  if(item.type === 'Feature' && item.geometry) return deepClone(item);
  if(item.geometry && item.geometry.type){
    return {
      type:'Feature',
      properties:{name: item.name || name || item.properties?.name || ''},
      geometry: deepClone(item.geometry),
    };
  }
  return null;
}

function findFirstArray(obj, keys){
  if(!obj) return null;
  return keys.map(k => obj[k]).find(v => Array.isArray(v)) || null;
}

function normalizePlaces(items, fallbackName='Place'){
  return (items || []).map(item => ({
    name: item.name || fallbackName,
    lat: Number(item.lat),
    lng: Number(item.lng ?? item.lon),
  })).filter(item => Number.isFinite(item.lat) && Number.isFinite(item.lng));
}

function pointsFromFeatureGeometry(feature, name='Border'){
  const out = [];
  const seen = new Set();
  const add = (coords) => {
    coords.forEach(([lng, lat]) => {
      const key = `${lat.toFixed(4)},${lng.toFixed(4)}`;
      if(!seen.has(key)){
        seen.add(key);
        out.push({lat, lng, name});
      }
    });
  };
  const geom = feature?.geometry;
  if(!geom) return out;
  if(geom.type === 'Polygon'){
    geom.coordinates.forEach(add);
  } else if(geom.type === 'MultiPolygon'){
    geom.coordinates.forEach(poly => poly.forEach(add));
  } else if(geom.type === 'LineString'){
    add(geom.coordinates);
  } else if(geom.type === 'MultiLineString'){
    geom.coordinates.forEach(add);
  }
  return out;
}

function featureToDisplayLines(feature){
  if(!feature?.geometry) return [];
  if(feature.geometry.type === 'LineString' || feature.geometry.type === 'MultiLineString'){
    return [feature];
  }
  try{
    const lines = turf.polygonToLine(feature);
    if(lines?.type === 'FeatureCollection') return lines.features;
    if(lines?.type === 'Feature') return [lines];
  }catch(e){}
  return [];
}

function getBoundaryDataset(cat){
  const data = preloadedData.boundaries || {};
  if(cat === 'county') return findFirstArray(data, ['counties']);
  if(cat === 'city') return findFirstArray(data, ['cities', 'towns', 'municipalities']);
  if(cat === 'neighborhood') return findFirstArray(data, ['neighborhoods']);
  if(cat === 'postcode') return findFirstArray(data, ['postcodes', 'zipCodes', 'zip_codes']);
  return null;
}

function resolveBoundaryFromPreloaded(cat, center){
  const items = getBoundaryDataset(cat);
  if(!items?.length) return null;
  const pt = turf.point([center.lng, center.lat]);
  for(const item of items){
    const feature = coerceFeature(item, item.name);
    if(!feature) continue;
    try{
      if(turf.booleanPointInPolygon(pt, feature)){
        const val = item.name || feature.properties?.name || null;
        return val ? { val, boundary: feature } : null;
      }
    }catch(e){}
  }
  return null;
}

function lookupPoiCollection(keys){
  const items = findFirstArray(preloadedData.pois, keys);
  return normalizePlaces(items);
}

function lookupLinearPoiCollection(keys, fallbackName='Line'){
  const items = findFirstArray(preloadedData.pois, keys);
  if(!Array.isArray(items)) return [];
  return items.flatMap(item => pointsFromFeatureGeometry(coerceFeature(item, item.name), item.name || fallbackName));
}

function getNamedPoiCollection(label){
  const keyMap = {
    'Park': ['parks'],
    'A Park': ['parks'],
    'Golf Course': ['golfCourses', 'golf_courses'],
    'A Golf Course': ['golfCourses', 'golf_courses'],
    'Library': ['libraries'],
    'A Library': ['libraries'],
    'Hospital': ['hospitals'],
    'A Hospital': ['hospitals'],
    'Museum': ['museums'],
    'A Museum': ['museums'],
    'Movie Theater': ['movieTheaters', 'movie_theaters', 'cinemas'],
    'A Movie Theater': ['movieTheaters', 'movie_theaters', 'cinemas'],
    'Zoo / Aquarium': ['zooAquariums', 'zoo_aquariums'],
    'A Zoo / Aquarium': ['zooAquariums', 'zoo_aquariums'],
    'Foreign Consulate': ['foreignConsulates', 'foreign_consulates', 'consulates'],
    'A Foreign Consulate': ['foreignConsulates', 'foreign_consulates', 'consulates'],
    'An Amusement Park': ['amusementParks', 'amusement_parks'],
    "Dunkin'": ['dunkin'],
    'Starbucks': ['starbucks'],
    'CVS': ['cvs'],
    "McDonald's": ['mcdonalds', 'mcDonalds'],
    'Hospitals': ['medicalSites', 'medical_sites', 'hospitals'],
    'Libraries': ['libraries'],
    'Parks': ['parks'],
    'Gas station': ['gasStations', 'gas_stations'],
    'A Body of Water': ['bodiesOfWater', 'bodies_of_water', 'waterBodies'],
    'Sea Level': ['seaLevel', 'sea_level', 'coastline'],
    'A Coastline': ['coastline', 'seaLevel', 'sea_level'],
  };
  const keys = keyMap[label];
  return keys ? lookupPoiCollection(keys) : [];
}

function getNamedLinearCollection(label){
  const keyMap = {
    'An Amtrak Line': ['amtrakLines', 'amtrak_lines'],
  };
  const keys = keyMap[label];
  return keys ? lookupLinearPoiCollection(keys, label) : [];
}

function getPreloadedBorderPoints(type){
  const items = getBoundaryDataset(type);
  if(!items?.length) return [];
  return items.flatMap(item => pointsFromFeatureGeometry(coerceFeature(item, item.name), item.name || 'Border'));
}

async function getCategoryInstances(catObj, center, radiusM){
  if(catObj.instances){
    try{
      const items = normalizePlaces(await catObj.instances(center, radiusM), catObj.label);
      if(items.length) return items;
    }catch(e){
      console.warn(`Instance lookup failed for ${catObj.label}:`, e);
    }
  }
  if(catObj.overpass){
    const items = await overpassSearch(catObj.overpass(center, radiusM), center, radiusM);
    return items.map(it=>({name:it.name || catObj.label, lat:it.lat, lng:it.lon || it.lng}));
  }
  return [];
}

function checkForResume(){
  const save = loadSave();
  if(!save) return;
  // Don't prompt if the game hasn't really started (only setup constraint)
  const realConstraints = save.constraints.filter(c=>!['_setup'].includes(c.type));
  if(!realConstraints.length) return;

  const km2 = (turf.area(save.validZone)/1e6).toFixed(1);
  const age = timeSince(save.ts);
  const lastQ = [...realConstraints].reverse().find(c=>c.type&&!c.type.startsWith('_'));
  const lastDesc = lastQ ? (QDEFS[lastQ.type]?.label || lastQ.type) : 'Setup';

  document.getElementById('resume-summary').innerHTML =
    `<b>${realConstraints.length}</b> question${realConstraints.length!==1?'s':''} asked &nbsp;·&nbsp; ` +
    `<b>${km2} km²</b> remaining<br>` +
    `Last: <b>${lastDesc}</b><br>` +
    `<span style="color:var(--dim);font-size:8.5px">Saved ${age}</span>`;

  document.getElementById('resume-overlay').classList.remove('hidden');
}

function resumeGame(){
  const save = loadSave();
  if(!save){ discardAndNew(); return; }

  hideRadiusMi = save.hideRadiusMi || 0.25;
  gameMode = save.gameMode || 'seeker';
  hiderStation = save.hiderStation || null;
  validZone = save.validZone;
  constraints = save.constraints;

  // Dismiss resume overlay and setup overlay
  document.getElementById('resume-overlay').classList.add('hidden');
  const ov = document.getElementById('setup-overlay');
  ov.classList.add('hidden');
  setTimeout(()=>{ ov.style.display='none'; }, 420);

  // Wait for MBTA data then restore
  const restore = () => {
    applyHideRadiusVisuals();
    renderZone();
    renderLog();
    applyGameMode();
    // Restore hider station pin if saved
    if(hiderStation){
      if(_hiderLocMarker) _hiderLocMarker.remove();
      _hiderLocMarker = L.marker([hiderStation.lat, hiderStation.lng], {icon:hiderPin(), zIndexOffset:3000}).addTo(map);
      renderHiderStationBadge();
    }
    const km2 = (turf.area(validZone)/1e6).toFixed(1);
    toast(`Game resumed — ${km2} km² in play`);
    if(gameMode !== 'hider'){
      document.getElementById('panel').classList.remove('collapsed');
      setTimeout(()=>document.getElementById('panel').classList.add('collapsed'), 2000);
    }
    switchTab(gameMode === 'hider' ? 'hider' : 'log');
  };
  if(mbdataReady) restore();
  else { const iv = setInterval(()=>{ if(mbdataReady){ clearInterval(iv); restore(); }}, 200); }
}

function discardAndNew(){
  clearSave();
  hiderStation = null;
  if(_hiderLocMarker){ _hiderLocMarker.remove(); _hiderLocMarker = null; }
  document.getElementById('resume-overlay').classList.add('hidden');
}

function timeSince(ts){
  const s = Math.floor((Date.now()-ts)/1000);
  if(s < 60) return 'just now';
  if(s < 3600) return `${Math.floor(s/60)}m ago`;
  if(s < 86400) return `${Math.floor(s/3600)}h ago`;
  return `${Math.floor(s/86400)}d ago`;
}

// Draw radius circles without recomputing validZone (for resume)
function applyHideRadiusVisuals(){
  const stops = Object.values(stopLineMap);
  if(!stops.length) return;
  radiusLayer.clearLayers();
  const radiusMeters = hideRadiusMi * 1609.34;
  stops.forEach(s=>{
    L.circle([s.lat,s.lng],{
      radius:radiusMeters, color:'#4ab8d4', weight:2,
      opacity:0.8, fillColor:'#4ab8d4', fillOpacity:0.15,
      dashArray:'6 4', interactive:false
    }).addTo(radiusLayer);
  });
}

// ══════════════════════════════════════════════════════
//  QUESTION DEFINITIONS
// ══════════════════════════════════════════════════════
const QDEFS = {
  radar:{
    label:'Radar', colorTag:'tag-radar',
    pickSteps:[{key:'center', label:'Tap map — set your location'}],
    isReady:p=>p.center&&p.radius_miles,
    toJSON:p=>({type:'radar',center:p.center,radius_miles:p.radius_miles}),
    applyToZone:(zone,q)=>q.answer==='yes'?safeIsect(zone,makeCircle(q.center,q.radius_miles,'miles')):safeDiff(zone,makeCircle(q.center,q.radius_miles,'miles')),
    describe:q=>`<b>${q.answer==='yes'?'WITHIN':'OUTSIDE'}</b> ${q.radius_miles}mi radar`
  },
  thermo:{
    label:'Thermometer', colorTag:'tag-thermo',
    pickSteps:[{key:'center', label:'Tap map — your current position'}],
    isReady:p=>p.center&&p.travel_miles,
    toJSON:p=>({type:'thermo',center:p.center,travel_miles:p.travel_miles}),
    applyToZone:(zone,q)=>q.answer==='closer'?safeIsect(zone,makeCircle(q.center,q.travel_miles,'miles')):safeDiff(zone,makeCircle(q.center,q.travel_miles,'miles')),
    describe:q=>`<b>${q.answer==='closer'?'CLOSER':'FURTHER'}</b> than ${q.travel_miles}mi from seeker`
  },
  measure:{
    label:'Measure', colorTag:'tag-measure',
    pickSteps:[{key:'center', label:'Tap map — your location'}],
    isReady:p=>p.center&&p.measure_cat&&p.measure_seeker_dist!=null,
    toJSON:p=>({
      type:'measure',
      center:p.center,
      category:p.measure_cat,
      category_label:p.measure_cat_label,
      seeker_nearest:p.measure_seeker_nearest,   // {lat,lng,name} — seeker's nearest instance
      seeker_dist:p.measure_seeker_dist,          // seeker's distance to their nearest
      all_instances:p.measure_all_instances||[],  // all known instances for zone geometry
      question:`Compared to me, are you closer to or further from your nearest ${p.measure_cat_label}? I am ${p.measure_seeker_dist.toFixed(2)} mi from mine.`,
      answer_opts:['closer','further']
    }),
    applyToZone:(zone,q)=>{
      if(!q.all_instances||!q.all_instances.length) return zone;
      try{
        // Zone = union of circles of radius seeker_dist around every instance
        // "closer" = inside that union; "further" = outside
        const circles = q.all_instances.map(p=>makeCircle(p, q.seeker_dist, 'miles'));
        let union = circles[0];
        for(let i=1;i<circles.length;i++){
          try{ union = turf.union(union, circles[i]) || union; }catch(e){}
        }
        if(q.answer==='closer') return safeIsect(zone, union);
        return safeDiff(zone, union);
      }catch(e){ return zone; }
    },
    describe:q=>`<b>${q.answer==='closer'?'CLOSER':'FURTHER'}</b> than seeker (${q.seeker_dist?.toFixed(2)}mi) from nearest ${q.category_label}`
  },
  tentacles:{
    label:'Tentacles', colorTag:'tag-tentacles',
    pickSteps:[{key:'center', label:'Tap map — your location'}],
    isReady:p=>p.center&&p.tentacle_options&&p.tentacle_options.length>=2,
    toJSON:p=>({type:'tentacles',center:p.center,radius_miles:p.radius_miles||1,options:p.tentacle_options}),
    applyToZone:(zone,q)=>{
      const circle=makeCircle(q.center,q.radius_miles||1,'miles');
      if(q.answer==='no') return safeDiff(zone,circle);
      const inCircle=safeIsect(zone,circle);
      const optIdx=q.options?q.options.findIndex(o=>o.name===q.answer):-1;
      if(optIdx>=0&&q.options.length>=2){
        try{
          const pts=turf.featureCollection(q.options.map(o=>turf.point([o.lng,o.lat])));
          const cells=turf.voronoi(pts,{bbox:[-72,41.5,-70,43]});
          if(cells&&cells.features[optIdx]) return safeIsect(inCircle,cells.features[optIdx]);
        }catch(e){}
      }
      return inCircle;
    },
    describe:q=>q.answer==='no'?`<b>NOT WITHIN</b> ${q.radius_miles||1}mi of seeker`:`<b>CLOSEST TO</b> ${q.answer}`
  },
  matching:{
    label:'Matching', colorTag:'tag-matching',
    pickSteps:[{key:'center', label:'Tap map — your location'}],
    isReady:p=>p.center&&p.matching_cat&&p.matching_seeker_val,
    toJSON:p=>({
      type:'matching',
      center:p.center,
      category:p.matching_cat,
      category_label:p.matching_cat_label,
      seeker_val:p.matching_seeker_val,
      boundary_geojson: p._matching_boundary_simplified || p.matching_boundary || null,
      question:`Are we in the same ${p.matching_cat_label}? Mine is "${p.matching_seeker_val}".`,
      answer_opts:['Yes','No']
    }),
    applyToZone:(zone,q)=>{
      if(!q.boundary_geojson) return zone;
      try{
        // `matching_boundary` is normalized to the actual containing region polygon.
        // Yes = keep only that region; No = eliminate that region.
        const result = q.answer==='Yes'
          ? safeIsect(zone, q.boundary_geojson)
          : safeDiff(zone, q.boundary_geojson);
        if(result && turf.area(result) > 1000) return result;
        return zone;
      } catch(e){ return zone; }
    },
    describe:q=>`<b>${q.answer==='Yes'?'SAME':'DIFFERENT'}</b> ${q.category_label} (seeker: ${q.seeker_val})`
  },
  nearest:{
    label:'Nearest', colorTag:'tag-nearest',
    pickSteps:[{key:'center', label:'Tap map — your location'}],
    isReady:p=>p.center&&p.nearest_cat&&p.nearest_seeker_poi,
    toJSON:p=>({
      type:'nearest',
      center:p.center,
      category:p.nearest_cat,
      category_label:p.nearest_cat_label,
      seeker_poi:p.nearest_seeker_poi,
      all_pois:p.nearest_all_pois||[],
      voronoi_geojson:p.nearest_voronoi||null,
      question:`Is the nearest ${p.nearest_cat_label} to you the same as mine? Mine is "${p.nearest_seeker_poi.name}".`,
      answer_opts:['Yes','No']
    }),
    applyToZone:(zone,q)=>{
      if(!q.voronoi_geojson) return zone;
      try{
        // Voronoi cell contains the "same nearest" region
        // Yes = hider shares same nearest → intersect (keep only that cell)
        // No = different nearest → difference (remove that cell)
        const result = q.answer==='Yes'
          ? safeIsect(zone, q.voronoi_geojson)
          : safeDiff(zone, q.voronoi_geojson);
        if(result && turf.area(result) > 1000) return result;
        return zone;
      }catch(e){ return zone; }
    },
    describe:q=>`Nearest ${q.category_label}: <b>${q.answer==='Yes'?'SAME':'DIFFERENT'}</b> (seeker's: ${q.seeker_poi?.name})`
  },
  photo:{
    label:'Photo', colorTag:'tag-photo',
    pickSteps:[],
    isReady:p=>p.photo_prompt&&p.photo_prompt.trim(),
    toJSON:p=>({type:'photo',prompt:p.photo_prompt}),
    applyToZone:(zone)=>zone,
    describe:q=>`📸 ${q.prompt}`
  },
  custom_boundary:{
    label:'Boundary', colorTag:'tag-nearest',
    pickSteps:[],
    isReady:p=>Array.isArray(p.custom_boundary_points) && p.custom_boundary_points.length >= 3 && !!p.custom_boundary_mode,
    toJSON:p=>({
      type:'custom_boundary',
      boundary_geojson:p.custom_boundary_geojson,
      mode:p.custom_boundary_mode,
    }),
    applyToZone:(zone,q)=>{
      if(!q.boundary_geojson) return zone;
      return q.mode === 'include'
        ? safeIsect(zone, q.boundary_geojson)
        : safeDiff(zone, q.boundary_geojson);
    },
    describe:q=>`<b>${q.mode==='include'?'INCLUDE':'EXCLUDE'}</b> custom boundary`
  }
};

// ══════════════════════════════════════════════════════
//  GEOMETRY
// ══════════════════════════════════════════════════════
function cloneGeo(g){return JSON.parse(JSON.stringify(g));}
function fmt(p){return`${p.lat.toFixed(3)},${p.lng.toFixed(3)}`;}
function toPt(p){return turf.point([p.lng,p.lat]);}
function turfDist(a,b){return turf.distance(toPt(a),toPt(b),{units:'miles'});}
function makeCircle(c,r,u){return turf.circle([c.lng,c.lat],r,{units:u,steps:72});}
function safeIsect(z,o){try{const r=turf.intersect(z,o);return r||z;}catch(e){return z;}}
function safeDiff(z,o){try{const r=turf.difference(z,o);return r||z;}catch(e){return z;}}

function compassHalf(ref,dir){
  const D=14,la=ref.lat,lo=ref.lng;
  const h={
    'N':[[lo-D,la],[lo+D,la],[lo+D,la+D],[lo-D,la+D],[lo-D,la]],
    'S':[[lo-D,la-D],[lo+D,la-D],[lo+D,la],[lo-D,la],[lo-D,la-D]],
    'E':[[lo,la-D],[lo+D,la-D],[lo+D,la+D],[lo,la+D],[lo,la-D]],
    'W':[[lo-D,la-D],[lo,la-D],[lo,la+D],[lo-D,la+D],[lo-D,la-D]],
    'NE':[[lo,la],[lo+D,la],[lo+D,la+D],[lo,la+D],[lo,la]],
    'NW':[[lo-D,la],[lo,la],[lo,la+D],[lo-D,la+D],[lo-D,la]],
    'SE':[[lo,la-D],[lo+D,la-D],[lo+D,la],[lo,la],[lo,la-D]],
    'SW':[[lo-D,la-D],[lo,la-D],[lo,la],[lo-D,la],[lo-D,la-D]]
  }[dir];
  return turf.polygon([h]);
}

function bisectorHalf(ptA,ptB,side){
  const pa=toPt(ptA),pb=toPt(ptB),mid=turf.midpoint(pa,pb);
  const bearAB=turf.bearing(pa,pb);
  const toward=side==='a'?(bearAB+180)%360:bearAB;
  const FAR=1500;
  const bL=turf.destination(mid,FAR,bearAB+90,{units:'kilometers'}).geometry.coordinates;
  const bR=turf.destination(mid,FAR,bearAB-90,{units:'kilometers'}).geometry.coordinates;
  const c1=turf.destination(turf.point(bL),FAR,toward,{units:'kilometers'}).geometry.coordinates;
  const c2=turf.destination(turf.point(bR),FAR,toward,{units:'kilometers'}).geometry.coordinates;
  return turf.polygon([[bL,c1,c2,bR,bL]]);
}

function makeBand(a,b,axis){
  const BIG=40;
  if(axis==='lat'){const mn=Math.min(a.lat,b.lat),mx=Math.max(a.lat,b.lat);return turf.polygon([[[-BIG*4,mn],[BIG*4,mn],[BIG*4,mx],[-BIG*4,mx],[-BIG*4,mn]]]);}
  else{const mn=Math.min(a.lng,b.lng),mx=Math.max(a.lng,b.lng);return turf.polygon([[[mn,-BIG],[mx,-BIG],[mx,BIG],[mn,BIG],[mn,-BIG]]]);}
}

function buildCustomBoundaryFeature(points){
  if(!Array.isArray(points) || points.length < 3) return null;
  const ring = points.map(p => [p.lng, p.lat]);
  const first = ring[0], last = ring[ring.length - 1];
  if(first[0] !== last[0] || first[1] !== last[1]) ring.push(first);
  try{
    return turf.polygon([ring]);
  }catch(e){
    return null;
  }
}
