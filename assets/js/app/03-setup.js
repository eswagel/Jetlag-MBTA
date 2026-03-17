// ══════════════════════════════════════════════════════
//  SETUP SCREEN
// ══════════════════════════════════════════════════════
function selectRadius(el){
  document.querySelectorAll('.radius-opt').forEach(o=>o.classList.remove('selected'));
  el.classList.add('selected');
  hideRadiusMi = parseFloat(el.dataset.mi);
}

function startGame(){
  // Build union of all station buffers at chosen radius
  toast('Computing valid zone…');
  setTimeout(()=>{
    applyHideRadius();
    // Dismiss overlay
    const ov = document.getElementById('setup-overlay');
    ov.classList.add('hidden');
    setTimeout(()=>{ ov.style.display='none'; }, 420);
    applyGameMode();
    if(gameMode === 'hider' || gameMode === 'dev'){
      promptHiderStationPick();
    } else {
      document.getElementById('panel').classList.remove('collapsed');
      setTimeout(()=>document.getElementById('panel').classList.add('collapsed'), 1800);
    }
  }, 60);
}

function promptHiderStationPick(){
  _pickingHiderStation = true;
  document.getElementById('panel').classList.add('collapsed');
  showBanner('🫣 TAP YOUR STATION on the map to set your hiding location');
}

function buildHideRadiusZone(){
  const stops = Object.values(stopLineMap);
  console.log(`applyHideRadius: ${stops.length} stops in stopLineMap`);
  if(!stops.length){
    return null;
  }

  // Draw individual radius circles for each stop using L.circle (meters, always crisp)
  const radiusMeters = hideRadiusMi * 1609.34;

  // Build union of all circles for zone clipping
  let union = makeCircle(stops[0], hideRadiusMi, 'miles');
  for(let i=1; i<stops.length; i++){
    try{
      const c = makeCircle(stops[i], hideRadiusMi, 'miles');
      union = turf.union(union, c) || union;
    }catch(e){}
  }

  // Intersect with full bounding area
  return safeIsect(INIT_POLY, union);
}

function drawHideRadiusVisuals(){
  const stops = Object.values(stopLineMap);
  if(!stops.length) return;
  radiusLayer.clearLayers();
  const radiusMeters = hideRadiusMi * 1609.34;
  stops.forEach(s => {
    L.circle([s.lat, s.lng], {
      radius: radiusMeters,
      color: '#4ab8d4',
      weight: 2,
      opacity: 0.8,
      fillColor: '#4ab8d4',
      fillOpacity: 0.15,
      dashArray: '6 4',
      interactive: false
    }).addTo(radiusLayer);
  });
}

function applyHideRadius(){
  const zone = buildHideRadiusZone();
  if(!zone){
    toast('⚠ Stop data not loaded yet — check console');
    return;
  }

  drawHideRadiusVisuals();
  validZone = zone;
  constraints = [{
    type:'_setup',
    answer:'applied',
    _label:`Hide radius: ${hideRadiusMi < 1 ? (hideRadiusMi*5280).toFixed(0)+' ft' : hideRadiusMi+' mi'} from any station`
  }];
  renderZone();
  renderLog();
  const km2 = (turf.area(validZone)/1e6).toFixed(1);
  toast(`Zone set — ${km2} km² in play`);
  saveGame();
}

// ══════════════════════════════════════════════════════
//  ZONE RENDERING
// ══════════════════════════════════════════════════════
function renderZone(){
  maskLayer.clearLayers();
  borderLayer.clearLayers();
  if(!validZone) return;
  // Red tinted mask = everything OUTSIDE valid zone
  try{ const mask=turf.difference(INIT_POLY,validZone); if(mask) maskLayer.addData(mask); }catch(e){}
  // Green outline = valid zone
  borderLayer.addData(validZone);
  updateStat();
}

function updateStat(){
  const km2=validZone?(turf.area(validZone)/1e6).toFixed(1):'0';
  document.getElementById('zone-stat').textContent=`${km2} km²`;
  document.getElementById('zone-area').textContent=`${km2} km² in play`;
}

function resetZone(){
  applyHideRadius();
  clearSave();
  toast('Zone reset to hide-radius area');
}

// ══════════════════════════════════════════════════════
//  MAP CLICK
// ══════════════════════════════════════════════════════
function onMapClick(e){
  if(_hiderPickingLocation){
    hiderSetLocation(e.latlng.lat, e.latlng.lng, 'map tap');
    return;
  }
  if(qtype==='custom_boundary' && qparams._drawingBoundary){
    if(!Array.isArray(qparams.custom_boundary_points)) qparams.custom_boundary_points = [];
    const {lat,lng}=e.latlng;
    qparams.custom_boundary_points.push({lat,lng});
    const m=L.marker([lat,lng],{icon:seekerPin('#20c8b0'),zIndexOffset:2000}).addTo(map);
    seekerPinMarkers.push(m);
    qparams.custom_boundary_geojson = buildCustomBoundaryFeature(qparams.custom_boundary_points);
    if(typeof syncCustomBoundaryPreview === 'function') syncCustomBoundaryPreview();
    if(typeof renderBoundaryBody === 'function') renderBoundaryBody();
    updatePreview();
    return;
  }
  if(pickStep<0||pickStep>=pickStepDefs.length) return;
  const {lat,lng}=e.latlng;
  qparams[pickStepDefs[pickStep].key]={lat,lng};
  const cols=['#e84040','#f0a030','#a060ff','#20c8b0'];
  const m=L.marker([lat,lng],{icon:seekerPin(cols[pickStep%cols.length]),zIndexOffset:2000}).addTo(map);
  seekerPinMarkers.push(m);
  pickStep++;
  if(pickStep>=pickStepDefs.length){
    hideBanner();
    document.getElementById('panel').classList.remove('collapsed');
    if(QDEFS[qtype].isReady(qparams)) generateJSON();
  } else {
    showBanner(pickStepDefs[pickStep].label);
  }
  renderBuildBody();
  updatePreview();
  if(qtype === 'thermo') tryGenerate();
}

// ══════════════════════════════════════════════════════
//  BANNER
// ══════════════════════════════════════════════════════
function showBanner(msg){document.getElementById('banner-msg').textContent=msg;document.getElementById('pick-banner').classList.add('visible');}
function hideBanner(){document.getElementById('pick-banner').classList.remove('visible');}
function dismissBanner(){
  pickStep=-1;
  if(qtype==='custom_boundary') qparams._drawingBoundary = false;
  hideBanner();
  if(qtype==='custom_boundary' && typeof renderBoundaryBody === 'function') renderBoundaryBody();
  else renderBuildBody();
}

function useMyLocation(key, stepIndex){
  if(!navigator.geolocation){ toast('Geolocation not available on this device'); return; }
  const btn = document.getElementById(`gps-btn-${stepIndex}`);
  if(btn){ btn.classList.add('locating'); btn.textContent = '⏳ Locating…'; }
  navigator.geolocation.getCurrentPosition(
    (pos)=>{
      const lat = pos.coords.latitude, lng = pos.coords.longitude;
      const m = L.marker([lat,lng],{icon:seekerPin('#20c8b0'),zIndexOffset:3000}).addTo(map);
      seekerPinMarkers.push(m);
      map.setView([lat,lng], Math.max(map.getZoom(), 14));
      // Set param and advance step — same logic as onMapClick
      qparams[key] = {lat, lng};
      pickStep++;
      if(btn){ btn.classList.remove('locating'); btn.classList.add('located'); btn.textContent = '✓ Located'; }
      if(pickStep >= pickStepDefs.length){
        hideBanner();
        document.getElementById('panel').classList.remove('collapsed');
        if(QDEFS[qtype].isReady(qparams)) generateJSON();
      } else {
        showBanner(pickStepDefs[pickStep].label);
      }
      renderBuildBody();
      updatePreview();
      if(qtype === 'thermo') tryGenerate();
      toast(`📡 Got your location (±${Math.round(pos.coords.accuracy)}m)`);
    },
    (err)=>{
      if(btn){ btn.classList.remove('locating'); btn.textContent = '📡 Use My Location'; }
      const msg = err.code === 1 ? 'Location permission denied' : err.code === 2 ? 'Location unavailable' : 'Location request timed out';
      toast(msg);
    },
    { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 }
  );
}

// ══════════════════════════════════════════════════════
//  BUILD UI
// ══════════════════════════════════════════════════════
function selectQType(type){
  qtype=type;
  qparams={radius_miles:1, travel_miles:0.5};
  pickStep=-1; pickStepDefs=QDEFS[type].pickSteps;
  clearMarkers(); previewLayer.clearLayers(); simulLayer.clearLayers(); simulMaskLayer.clearLayers();
  if(typeof setPreviewMapMode === 'function') setPreviewMapMode(false);
  document.getElementById('json-out-section').style.display='none';
  document.getElementById('map-simul-bar').classList.remove('visible');
  document.querySelectorAll('.qbtn').forEach(b=>b.classList.toggle('on',b.dataset.q===type));
  document.getElementById('panel').classList.remove('collapsed');
  if(pickStepDefs.length > 0){
    pickStep=0; showBanner(pickStepDefs[0].label);
    document.getElementById('panel').classList.add('collapsed');
  } else {
    hideBanner();
  }
  renderBuildBody();
}
