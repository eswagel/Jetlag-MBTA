// Shared build-mode markers, display helpers, and geometry rendering.

function makeStopIcon(colors){
  const n = colors.length;
  const r = n > 1 ? 6 : 5;
  const pad  = 2;
  const size = (r + pad) * 2;
  const cx   = size / 2;
  const cy   = size / 2;

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

function measurePin(){
  return L.divIcon({className:'', iconSize:[0,0], html:`
    <div style="transform:translate(-10px,-10px);width:20px;height:20px">
      <div style="width:14px;height:14px;background:#20c8b0;border:2.5px solid white;border-radius:3px;transform:rotate(45deg) translate(3px,3px);box-shadow:0 2px 8px rgba(0,0,0,0.5)"></div>
    </div>`});
}

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
  const what = /line|coast|sea level|border/i.test(categoryLabel) ? 'nearest point' : 'nearest';
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

async function getMeasureLinearFeatures(catObj, center){
  await loadPoiData();
  if(catObj.label === 'An Amtrak Line'){
    return getNamedLinearFeatures(catObj.label);
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
