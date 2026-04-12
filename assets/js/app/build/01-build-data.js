// Shared build-mode catalogs, data loaders, and query helpers.

// Safe onclick dispatch — avoids quote escaping in HTML attributes.
const _clicks = [];
function _c(fn){ _clicks.push(fn); return `_dispatch(${_clicks.length-1})`; }
function _dispatch(i){ _clicks[i](); }
function _clearClicks(){ _clicks.length=0; }

// Matching categories — "Are we in the same ___?"
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

// Nearest categories — "Is the nearest ___ to me the same as to you?"
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
    return {type:'Feature', properties:{name:best.display_name}, geometry:best.geojson};
  } catch(e){
    console.warn('Boundary fetch failed:', e);
    return null;
  }
}

const _landmassCache = {
  ready: false,
  pieces: [],
  stopIndex: {},
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

// Administrative boundary loader.
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

    const q=`[out:json][timeout:30];(
      relation["admin_level"="6"]["boundary"="administrative"](${S},${W},${N},${E});
      relation["admin_level"="8"]["boundary"="administrative"](${S},${W},${N},${E});
    );out geom 2000;`;
    const data = await overpassRaw(q);

    (data.elements||[]).forEach(rel=>{
      if(rel.type!=='relation') return;
      const level = rel.tags?.admin_level;
      const name  = rel.tags?.name || '';
      (rel.members||[]).forEach(m=>{
        if(m.type!=='way'||!m.geometry||m.geometry.length<2) return;
        const coords = m.geometry.map(p=>[p.lon,p.lat]);
        const feat = {type:'Feature',properties:{name,admin_level:level,rel_id:rel.id},geometry:{type:'LineString',coordinates:coords}};
        if(level==='6') _adminBoundaries.counties.push(feat);
        else if(level==='8') _adminBoundaries.towns.push(feat);
      });
    });

    if(countyLayer) countyLayer.addData({type:'FeatureCollection',features:_adminBoundaries.counties});
    if(townLayer)   townLayer.addData({type:'FeatureCollection',features:_adminBoundaries.towns});
    console.log(`Admin boundaries: ${_adminBoundaries.counties.length} county segments, ${_adminBoundaries.towns.length} town segments`);
  }catch(e){ console.warn('Admin boundary load failed:', e); }
}

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

// Raw Overpass fetch returning parsed JSON.
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

async function nearestBorderPoints(center, type, adminLevel){
  const pad=0.3;
  const s=center.lat-pad,n=center.lat+pad,w=center.lng-pad,e=center.lng+pad;
  const q=`[out:json][timeout:25];relation["admin_level"="${adminLevel}"]["boundary"="administrative"](${s},${w},${n},${e});out geom 500;`;
  const data=await overpassRaw(q);
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
  { group:'Transit', icon:'🚆', label:'An Amtrak Line',
    instances: async () => {
      await loadPoiData();
      const preloaded = getNamedLinearCollection('An Amtrak Line');
      if(preloaded.length) return preloaded;
      const S=41.0, N=43.5, W=-72.0, E=-70.0;
      const q = `[out:json][timeout:30];(
        relation["route"="train"]["operator"~"Amtrak",i](${S},${W},${N},${E});
        relation["route"="train"]["name"~"Downeaster|Northeast Corridor|NEC|Acela|Regional",i](${S},${W},${N},${E});
      );out geom 500;`;
      const data = await overpassRaw(q);
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
      const q2=`[out:json][timeout:30];way["railway"="rail"]["usage"="main"](${S},${W},${N},${E});out geom 300;`;
      const data2=await overpassRaw(q2);
      return densifyWaysToPoints(data2, 0.3);
    }},
  { group:'Transit', icon:'🚉', label:'A Commuter Rail Station',
    instances: async () => {
      const list = commuterRailStopsList.length ? commuterRailStopsList : [];
      const T_BBOX = {minLat:42.18, maxLat:42.67, minLng:-71.55, maxLng:-70.85};
      return list.filter(s =>
        s.lat >= T_BBOX.minLat && s.lat <= T_BBOX.maxLat &&
        s.lng >= T_BBOX.minLng && s.lng <= T_BBOX.maxLng
      );
    }},

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

  { group:'Natural', icon:'🌊', label:'Sea Level',
    instances: async (c) => {
      await loadPoiData();
      const preloaded = getNamedPoiCollection('Sea Level');
      if(preloaded.length) return preloaded;
      const r = 50000;
      const q = `[out:json][timeout:25];way["natural"="coastline"](around:${r},${c.lat},${c.lng});out geom 300;`;
      const data = await overpassRaw(q);
      const pts = densifyWaysToPoints(data, 0.2);
      return pts.length ? pts : [{lat:42.3551, lng:-71.0497, name:'Boston Harbor shore'}];
    }},
  { group:'Natural', icon:'💧', label:'A Body of Water',
    instances: async (c) => {
      await loadPoiData();
      const preloaded = getNamedPoiCollection('A Body of Water');
      if(preloaded.length) return preloaded;
      const r = 35000;
      const q = `[out:json][timeout:25];(way["natural"~"^(water|bay)$"]["name"](around:${r},${c.lat},${c.lng});relation["natural"~"^(water|bay)$"]["name"](around:${r},${c.lat},${c.lng});way["waterway"="river"]["name"](around:${r},${c.lat},${c.lng}););out center 50;`;
      const data = await overpassRaw(q);
      return (data.elements||[]).filter(e=>e.center||e.lat).map(e=>({lat:e.center?.lat||e.lat,lng:e.center?.lon||e.lon,name:e.tags?.name||'Water'}));
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

async function overpassSearch(overpassBody, near){
  const query = `[out:json][timeout:25];(${overpassBody});out center 100;`;
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
