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
    toJSON:p=>({
      type:'tentacles',
      center:p.center,
      radius_miles:p.radius_miles||1,
      category:p._tcatlabel || p._tcat || p.tentacles_cat_label || null,
      category_label:p._tcatlabel || p._tcat || p.tentacles_cat_label || null,
      options:getTentacleOptionsInReach({
        center:p.center,
        radius_miles:p.radius_miles||1,
        options:p.tentacle_options || [],
      }),
    }),
    applyToZone:(zone,q)=>{
      const {circle, scope, regions} = buildTentacleRegions(q, zone);
      if(q.answer==='no') return safeDiff(zone,circle);
      const option = findTentacleOption(q, q.answer);
      const match = option
        ? regions.find(item => item.option.id === option.id)
        : null;
      return match?.region || scope || zone;
    },
    describe:q=>q.answer==='no'
      ? `<b>NOT WITHIN</b> ${q.radius_miles||1}mi of seeker`
      : `<b>CLOSEST TO</b> ${q.answer_label || getTentacleAnswerLabel(q, q.answer)}`
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
      line_id:p.matching_cat === 'line' ? (p.matching_line_id || null) : null,
      hide_radius_miles:p.matching_cat === 'line' ? (p.matching_hide_radius_miles ?? hideRadiusMi) : null,
      boundary_geojson: p._matching_boundary_simplified || p.matching_boundary || null,
      question:(p.matching_cat === 'line')
        ? `Is your station on the same ${p.matching_cat_label}? Mine is "${p.matching_seeker_val}".`
        : `Are we in the same ${p.matching_cat_label}? Mine is "${p.matching_seeker_val}".`,
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
function getActiveBuildQType(type=qtype, params=qparams){
  if(type === 'matching'){
    return params?._matching_mode === 'nearest' ? 'nearest' : 'matching';
  }
  return type;
}

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

function buildTentacleRegions(question, zone=null){
  const circle = makeCircle(question.center, question.radius_miles || 1, 'miles');
  const scope = zone ? exactIsect(zone, circle) : circle;
  const options = getTentacleOptionsInReach(question);
  if(!scope || options.length < 2){
    return {circle, scope, regions:[]};
  }
  try{
    const bbox = expandBboxMiles(turf.bbox(circle), 0.25);
    const points = turf.featureCollection(options.map((opt, i)=>turf.point([opt.lng, opt.lat], {id:opt.id, name:opt.name, index:i})));
    const cells = turf.voronoi(points, {bbox});
    if(!cells?.features?.length) return {circle, scope, regions:[]};
    const regions = [];
    options.forEach((opt, i) => {
      const cell = cells.features[i];
      if(!cell) return;
      const region = exactIsect(scope, cell);
      if(!region) return;
      regions.push({option:opt, region, index:i});
    });
    return {circle, scope, regions};
  }catch(e){
    return {circle, scope, regions:[]};
  }
}

function exactIsect(a,b){
  try{
    return turf.intersect(a,b) || null;
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
