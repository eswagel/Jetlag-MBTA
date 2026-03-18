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
  elevation: 'data/elevation-grid.json',
};
const INIT_POLY = turf.polygon([[
  [-71.70,41.85],[-70.40,41.85],[-70.40,42.80],[-71.70,42.80],[-71.70,41.85]
]]);

let map, maskLayer, borderLayer, radiusLayer, previewLayer, simulLayer, simulMaskLayer, pickedMarkers=[];
let townLayer, countyLayer, boundaryHighlightLayer;
const commuterRailStops = new Set();
const commuterRailStopsList = [];
let seekerPinMarkers = []; // seeker location dots — preserved across POI category changes
let thermoHandleMarker = null;
let validZone = cloneGeo(INIT_POLY);
let constraints = [];
let qtype=null, qparams={}, pickStep=-1, pickStepDefs=[];
let currentBuiltQuestion = null;
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
  elevation: null,
};
const elevationPointCache = new Map();

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
      constraints: constraints.map(c => JSON.parse(JSON.stringify(c, (k,v)=>{
        if(k === '_constraint_union') return undefined;
        return v instanceof Set ? [...v] : v;
      })))
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

async function loadElevationData(){
  if(preloadedData.elevation) return preloadedData.elevation;
  preloadedData.elevation = await fetchOptionalJSON(DATA_FILES.elevation, 'elevation grid');
  return preloadedData.elevation;
}

async function fetchPointElevation(lat, lng){
  const key = `${Number(lat).toFixed(5)},${Number(lng).toFixed(5)}`;
  if(elevationPointCache.has(key)) return elevationPointCache.get(key);
  const url = `https://epqs.nationalmap.gov/v1/json?x=${lng}&y=${lat}&units=Feet&wkid=4326&includeDate=false`;
  const promise = fetch(url, {headers:{'Accept':'application/json'}})
    .then(res => {
      if(!res.ok) throw new Error(`Elevation lookup failed (${res.status})`);
      return res.json();
    })
    .then(data => {
      const feet = Number(data?.value);
      if(!Number.isFinite(feet)) throw new Error('Invalid elevation response');
      return {
        feet,
        meters: feet * 0.3048,
        resolution: Number(data?.resolution) || null,
      };
    });
  elevationPointCache.set(key, promise);
  return promise;
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

function lookupLinearPoiFeatures(keys){
  const items = findFirstArray(preloadedData.pois, keys);
  return Array.isArray(items) ? items : [];
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
    'Sea Level': ['coastlineLines', 'coastline_lines'],
    'A Coastline': ['coastlineLines', 'coastline_lines'],
  };
  const keys = keyMap[label];
  return keys ? lookupLinearPoiCollection(keys, label) : [];
}

function getNamedLinearFeatures(label){
  const keyMap = {
    'An Amtrak Line': ['amtrakLines', 'amtrak_lines'],
    'Sea Level': ['coastlineLines', 'coastline_lines'],
    'A Coastline': ['coastlineLines', 'coastline_lines'],
  };
  const keys = keyMap[label];
  return keys ? lookupLinearPoiFeatures(keys) : [];
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
    isReady:p=>p.center&&p.travel_miles&&p.thermo_dest,
    toJSON:p=>({type:'thermo',center:p.center,travel_miles:p.travel_miles,thermo_dest:p.thermo_dest}),
    applyToZone:(zone,q)=>{
      if(!q.center || !q.thermo_dest) return zone;
      const half = thermoHalf(q.center, q.thermo_dest, q.answer==='closer' ? 'b' : 'a');
      return safeIsect(zone, half);
    },
    describe:q=>`<b>${q.answer==='closer'?'CLOSER':'FURTHER'}</b> to seeker after moving ${q.travel_miles}mi`
  },
  measure:{
    label:'Measure', colorTag:'tag-measure',
    pickSteps:[{key:'center', label:'Tap map — your location'}],
    isReady:p=>p.center&&p.measure_cat&&(
      p.measure_mode === 'elevation'
        ? Number.isFinite(p.measure_seeker_elevation_ft)
        : p.measure_seeker_dist!=null
    ),
    toJSON:p=>({
      type:'measure',
      center:p.center,
      mode:p.measure_mode || 'distance',
      category:p.measure_cat,
      category_label:p.measure_cat_label,
      seeker_nearest:p.measure_seeker_nearest,   // {lat,lng,name} — seeker's nearest instance
      seeker_dist:p.measure_seeker_dist,          // seeker's distance to their nearest
      seeker_elevation_ft:p.measure_seeker_elevation_ft ?? null,
      seeker_elevation_m:p.measure_seeker_elevation_m ?? null,
      all_instances:p.measure_all_instances||[],  // all known instances for zone geometry
      linear_features:p.measure_linear_features||[],
      question:(p.measure_mode === 'elevation')
        ? `Are you at a higher or lower elevation than me? I am ${p.measure_seeker_elevation_ft.toFixed(0)} ft above sea level.`
        : `Compared to me, are you closer to or further from your nearest ${p.measure_cat_label}? I am ${p.measure_seeker_dist.toFixed(2)} mi from mine.`,
      answer_opts:(p.measure_mode === 'elevation') ? ['higher','lower'] : ['closer','further']
    }),
    applyToZone:(zone,q)=>{
      try{
        const union = q._constraint_union || buildMeasureConstraintUnion(q, zone);
        if(!union) return zone;
        if(q.answer==='closer' || q.answer==='higher') return safeIsect(zone, union);
        return safeDiff(zone, union);
      }catch(e){ return zone; }
    },
    describe:q=>(q.mode === 'elevation')
      ? `<b>${q.answer==='higher'?'HIGHER':'LOWER'}</b> than seeker (${Number(q.seeker_elevation_ft).toFixed(0)} ft above sea level)`
      : `<b>${q.answer==='closer'?'CLOSER':'FURTHER'}</b> than seeker (${q.seeker_dist?.toFixed(2)}mi) from nearest ${q.category_label}`
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

function projectLocal(ll, origin){
  const lat0 = origin.lat * Math.PI / 180;
  return {
    x: (ll.lng - origin.lng) * 111.320 * Math.cos(lat0),
    y: (ll.lat - origin.lat) * 110.574,
  };
}

function unprojectLocal(pt, origin){
  const lat0 = origin.lat * Math.PI / 180;
  return [
    origin.lng + pt.x / (111.320 * Math.cos(lat0)),
    origin.lat + pt.y / 110.574,
  ];
}

function normVec(v){
  const d = Math.hypot(v.x, v.y) || 1;
  return {x: v.x / d, y: v.y / d};
}

function dividerFrame(ptA, ptB){
  const origin = {lat: ptA.lat, lng: ptA.lng};
  const b = projectLocal(ptB, origin);
  const along = normVec({x: b.x, y: b.y});
  const perp = {x: -along.y, y: along.x};
  return {origin, along, perp};
}

function thermoHalf(ptA,ptB,side){
  const {origin, along, perp} = dividerFrame(ptA, ptB);
  const toward = side === 'a' ? {x: -along.x, y: -along.y} : along;
  const halfWidthKm = 800;
  const depthKm = 1200;
  const ring = [
    unprojectLocal({x: perp.x * halfWidthKm, y: perp.y * halfWidthKm}, origin),
    unprojectLocal({x: perp.x * halfWidthKm + toward.x * depthKm, y: perp.y * halfWidthKm + toward.y * depthKm}, origin),
    unprojectLocal({x: -perp.x * halfWidthKm + toward.x * depthKm, y: -perp.y * halfWidthKm + toward.y * depthKm}, origin),
    unprojectLocal({x: -perp.x * halfWidthKm, y: -perp.y * halfWidthKm}, origin),
    unprojectLocal({x: perp.x * halfWidthKm, y: perp.y * halfWidthKm}, origin),
  ];
  return turf.polygon([ring]);
}

function thermoDividerLine(ptA,ptB){
  const {origin, perp} = dividerFrame(ptA, ptB);
  const reachKm = 1200;
  return turf.lineString([
    unprojectLocal({x: perp.x * reachKm, y: perp.y * reachKm}, origin),
    unprojectLocal({x: -perp.x * reachKm, y: -perp.y * reachKm}, origin),
  ]);
}

function makeBand(a,b,axis){
  const BIG=40;
  if(axis==='lat'){const mn=Math.min(a.lat,b.lat),mx=Math.max(a.lat,b.lat);return turf.polygon([[[-BIG*4,mn],[BIG*4,mn],[BIG*4,mx],[-BIG*4,mx],[-BIG*4,mn]]]);}
  else{const mn=Math.min(a.lng,b.lng),mx=Math.max(a.lng,b.lng);return turf.polygon([[[mn,-BIG],[mx,-BIG],[mx,BIG],[mn,BIG],[mn,-BIG]]]);}
}

function expandBboxMiles(bbox, miles){
  if(!Array.isArray(bbox) || bbox.length !== 4 || !Number.isFinite(miles)) return bbox;
  const midLat = ((bbox[1] + bbox[3]) / 2) * Math.PI / 180;
  const latDelta = miles / 69;
  const lngDelta = miles / (69 * Math.max(0.2, Math.cos(midLat)));
  return [
    bbox[0] - lngDelta,
    bbox[1] - latDelta,
    bbox[2] + lngDelta,
    bbox[3] + latDelta,
  ];
}

function clipFeatureToZone(feature, zone, miles){
  if(!feature || !zone) return feature;
  try{
    const bbox = expandBboxMiles(turf.bbox(zone), miles + 0.5);
    const clipped = turf.bboxClip(feature, bbox);
    if(clipped?.geometry) return clipped;
  }catch(e){}
  return feature;
}

function simplifyMeasureFeature(feature, q){
  if(!feature) return feature;
  const isCoast = /coast|sea level/i.test(q?.category_label || q?.category || '');
  if(!isCoast) return feature;
  try{
    return turf.simplify(feature, {tolerance:0.005, highQuality:false}) || feature;
  }catch(e){
    return feature;
  }
}

function buildElevationConstraintFeature(q, zone=null){
  const data = preloadedData.elevation;
  const thresholdFt = Number(q?.seeker_elevation_ft);
  const latitudes = data?.latitudes;
  const longitudes = data?.longitudes;
  const values = data?.values;
  if(!Number.isFinite(thresholdFt) || !Array.isArray(latitudes) || latitudes.length < 2 || !Array.isArray(longitudes) || longitudes.length < 2 || !Array.isArray(values)) return null;

  const zoneBbox = zone ? turf.bbox(zone) : [data.bbox?.west ?? longitudes[0], data.bbox?.south ?? latitudes[0], data.bbox?.east ?? longitudes[longitudes.length - 1], data.bbox?.north ?? latitudes[latitudes.length - 1]];
  const polys = [];

  for(let row = 0; row < latitudes.length - 1; row++){
    const south = latitudes[row];
    const north = latitudes[row + 1];
    if(north < zoneBbox[1] || south > zoneBbox[3]) continue;
    for(let col = 0; col < longitudes.length - 1; col++){
      const west = longitudes[col];
      const east = longitudes[col + 1];
      if(east < zoneBbox[0] || west > zoneBbox[2]) continue;

      const cellValues = [
        Number(values?.[row]?.[col]),
        Number(values?.[row]?.[col + 1]),
        Number(values?.[row + 1]?.[col]),
        Number(values?.[row + 1]?.[col + 1]),
      ].filter(Number.isFinite);
      if(cellValues.length < 3) continue;
      const avgFt = cellValues.reduce((sum, value) => sum + value, 0) / cellValues.length;
      if(avgFt < thresholdFt) continue;

      polys.push([[
        [west, south],
        [east, south],
        [east, north],
        [west, north],
        [west, south],
      ]]);
    }
  }

  if(!polys.length) return null;
  return turf.multiPolygon(polys);
}

function buildMeasureConstraintUnion(q, zone=null){
  if(!q) return null;
  try{
    if(q.mode === 'elevation'){
      const feature = buildElevationConstraintFeature(q, zone);
      if(!feature) return null;
      try{
        return turf.simplify(feature, {tolerance:0.0008, highQuality:false}) || feature;
      }catch(e){
        return feature;
      }
    }

    if(!Number.isFinite(q.seeker_dist)) return null;
    let union = null;
    if(q.linear_features?.length){
      const buffered = q.linear_features
        .map(item => coerceFeature(item, item.name))
        .filter(Boolean)
        .map(feature => {
          try{
            const clipped = clipFeatureToZone(feature, zone, q.seeker_dist);
            const simplified = simplifyMeasureFeature(clipped, q);
            return turf.buffer(simplified, q.seeker_dist, {units:'miles'});
          }catch(e){ return null; }
        })
        .filter(Boolean);
      union = buffered[0] || null;
      for(let i=1;i<buffered.length;i++){
        try{ union = turf.union(union, buffered[i]) || union; }catch(e){}
      }
    } else if(q.all_instances?.length){
      const circles = q.all_instances.map(p=>makeCircle(p, q.seeker_dist, 'miles'));
      union = circles[0] || null;
      for(let i=1;i<circles.length;i++){
        try{ union = turf.union(union, circles[i]) || union; }catch(e){}
      }
    }
    if(!union) return null;
    try{
      return turf.simplify(union, {tolerance:0.0008, highQuality:false}) || union;
    }catch(e){
      return union;
    }
  }catch(e){
    return null;
  }
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
