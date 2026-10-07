// ══════════════════════════════════════════════════════
//  SETUP SCREEN
// ══════════════════════════════════════════════════════
function selectRadius(el){
  document.querySelectorAll('.radius-opt').forEach(o=>o.classList.remove('selected'));
  el.classList.add('selected');
  hideRadiusMi = parseFloat(el.dataset.mi);
  _hideRadiusZoneCache = { miles: null, stopCount: 0, zone: null };
  _stopBaseRegionCache = { miles: null, stopCount: 0, entries: null };
}

function startGame(){
  if(!IS_GAME_SESSION){
    GameSession.open(CITY_PROFILES[selectedCityId], {mode:gameMode,radius:hideRadiusMi});
    return;
  }
  if(!mbdataReady || !Object.keys(stopLineMap).length){ toast(`Wait for ${ACTIVE_CITY.networkLabel} station data before starting.`); return; }
  // Build union of all station buffers at chosen radius
  toast('Computing valid zone…');
  setTimeout(()=>{
    applyHideRadius();
    // Dismiss overlay
    const ov = document.getElementById('setup-overlay');
    ov.classList.add('hidden');
    setTimeout(()=>{ ov.style.display='none'; }, 420);
    saveGame();
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

let _hideRadiusZoneCache = { miles: null, stopCount: 0, zone: null };
let _pendingYellowRegionFeature = null;

function getHardZoneForRender(){
  if(stopRegionState?.hardUnion) return stopRegionState.hardUnion;
  if(typeof hardZone !== 'undefined' && hardZone) return hardZone;
  if(typeof validZone !== 'undefined' && validZone) return validZone;
  return null;
}

function getSoftZoneForRender(){
  if(stopRegionState?.yellowUnion) return stopRegionState.yellowUnion;
  if(typeof softZone !== 'undefined' && softZone) return softZone;
  return null;
}

function getGreenFeaturesForRender(hard, soft){
  if(stopRegionState?.greenFeatures?.length) return stopRegionState.greenFeatures;
  if(!hard) return [];
  try{
    const green = soft ? turf.difference(hard, soft) : hard;
    return geometryToPolygonFeatures(green, {regionKind:'green'});
  }catch(e){
    return geometryToPolygonFeatures(hard, {regionKind:'green'});
  }
}

function getYellowFeaturesForRender(hard, soft){
  if(stopRegionState?.yellowFeatures?.length) return stopRegionState.yellowFeatures;
  if(!hard || !soft) return [];
  try{
    const yellow = turf.intersect(hard, soft);
    return geometryToPolygonFeatures(yellow, {regionKind:'yellow', menuLabel:'Exclude region'});
  }catch(e){
    return [];
  }
}

function buildRedMaskFeature(maskBase, hardZone){
  if(!maskBase || !hardZone) return null;
  return exactDiff(maskBase, hardZone);
}

function canOpenYellowRegionMenu(){
  const setupOverlay = document.getElementById('setup-overlay');
  if(setupOverlay && !setupOverlay.classList.contains('hidden')) return false;
  if(gameMode === 'hider') return false;
  if(_pickingHiderStation) return false;
  if(typeof _hiderPickingLocation !== 'undefined' && _hiderPickingLocation) return false;
  if(qtype === 'custom_boundary' && qparams._drawingBoundary) return false;
  if(pickStep >= 0 && pickStep < pickStepDefs.length) return false;
  return !!stopRegionState?.yellowFeatures?.some(feature=>!feature.properties?.catchmentPartial);
}

function findYellowRegionFeatureAtLatLng(latlng){
  if(!canOpenYellowRegionMenu()) return null;
  const pt = turf.point([latlng.lng, latlng.lat]);
  if(stopRegionState?.greenFeatures?.some(feature => {
    try{
      return turf.booleanPointInPolygon(pt, feature);
    }catch(e){
      return false;
    }
  })) return null;
  return stopRegionState.yellowFeatures.find(feature => {
    if(feature.properties?.catchmentPartial) return false;
    try{
      return turf.booleanPointInPolygon(pt, feature);
    }catch(e){
      return false;
    }
  }) || null;
}

function dismissYellowRegionMenu(){
  _pendingYellowRegionFeature = null;
  if(map) map.closePopup();
}

function openYellowRegionMenu(latlng, feature){
  if(!map || !feature) return;
  _pendingYellowRegionFeature = cloneGeo(feature);
  const actionLabel = feature.properties?.menuLabel || 'Exclude region';
  const popup = L.popup({closeButton:true, autoPan:true, offset:[0, -4]})
    .setLatLng(latlng)
    .setContent(`
      <div class="stop-popup">
        <div class="stop-popup-name">Temporary Region</div>
        <div style="font-size:9px;color:var(--dim);line-height:1.55">
          This yellow area is only ruled out for the moment. Exclude it permanently and add that choice to the log?
        </div>
        <button class="btn btn-red yellow-region-menu-btn" type="button" onclick="excludePendingYellowRegion()">${actionLabel}</button>
      </div>
    `);
  popup.on('remove', ()=>{ _pendingYellowRegionFeature = null; });
  popup.openOn(map);
}

function handleYellowRegionTap(latlng){
  const feature = findYellowRegionFeatureAtLatLng(latlng);
  if(!feature) return false;
  openYellowRegionMenu(latlng, feature);
  return true;
}

function excludePendingYellowRegion(){
  if(!_pendingYellowRegionFeature) return;
  const feature = cloneGeo(_pendingYellowRegionFeature);
  const nextConstraint = normalizeConstraintEntry({
    type:'custom_boundary',
    boundary_geojson: feature,
    mode:'exclude',
    _label:'Exclude region',
    constraint_effect:'hard',
  });
  dismissYellowRegionMenu();
  if(!applyConstraintIncrementally(nextConstraint)) return;
  switchTab('log');
  toast('Region excluded');
}

function buildHideRadiusZone(){
  const stops = Object.values(stopLineMap);
  console.log(`applyHideRadius: ${stops.length} stops in stopLineMap`);
  if(!stops.length){
    return null;
  }

  if(
    _hideRadiusZoneCache.zone &&
    _hideRadiusZoneCache.miles === hideRadiusMi &&
    _hideRadiusZoneCache.stopCount === stops.length
  ){
    return cloneGeo(_hideRadiusZoneCache.zone);
  }

  // Build union of all circles for zone clipping
  let union = makeCircle(stops[0], hideRadiusMi, 'miles');
  for(let i=1; i<stops.length; i++){
    try{
      const c = makeCircle(stops[i], hideRadiusMi, 'miles');
      union = turf.union(union, c) || union;
    }catch(e){}
  }

  // Intersect with full bounding area
  const zone = safeIsect(INIT_POLY, union);
  _hideRadiusZoneCache = {
    miles: hideRadiusMi,
    stopCount: stops.length,
    zone: zone ? cloneGeo(zone) : null,
  };
  return zone ? cloneGeo(zone) : null;
}

function drawHideRadiusVisuals(){
  radiusLayer.clearLayers();
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
  stopRegionState = deriveStopRegionState(validZone, constraints);
  softZone = stopRegionState?.yellowUnion || null;
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
  softLayer.clearLayers();
  borderLayer.clearLayers();
  dismissYellowRegionMenu();
  const hard = getHardZoneForRender();
  const soft = getSoftZoneForRender();
  const maskBase = buildHideRadiusZone() || INIT_POLY;
  if(!hard) return;
  const greenFeatures = getGreenFeaturesForRender(hard, soft);
  const yellowFeatures = getYellowFeaturesForRender(hard, soft);

  // Red mask = everything outside the hard zone
  try{
    const mask = buildRedMaskFeature(maskBase, stopRegionState?.survivingCatchments || hard);
    if(mask) maskLayer.addData(mask);
  }catch(e){}

  if(yellowFeatures.length){
    softLayer.addData(turf.featureCollection(yellowFeatures));
  } else if(soft){
    try{
      const yellow = turf.intersect(hard, soft);
      if(yellow) softLayer.addData(yellow);
    }catch(e){}
  }

  // Green = remaining hard zone after removing temporary exclusions
  if(greenFeatures.length){
    borderLayer.addData(turf.featureCollection(greenFeatures));
  }else{
    try{
      const green = soft ? turf.difference(hard, soft) : hard;
      if(green) borderLayer.addData(green);
      else if(!soft && !yellowFeatures.length) borderLayer.addData(hard);
    }catch(e){
      if(!soft && !yellowFeatures.length) borderLayer.addData(hard);
    }
  }
  updateStat();
}

function updateStat(){
  const hard = stopRegionState?.hardUnion || getHardZoneForRender();
  const km2=hard?(turf.area(hard)/1e6).toFixed(1):'0';
  document.getElementById('zone-stat').textContent=`${km2} km²`;
  document.getElementById('zone-area').textContent=`${km2} km² in play`;
}

function resetZone(){
  applyHideRadius();
  outgoingQuestions = {};
  clearTimeout(_saveGameTimer);
  _saveGameTimer = null;
  localStorage.removeItem(SAVE_KEY);
  saveGame();
  toast('Zone reset to hide-radius area');
}

// ══════════════════════════════════════════════════════
//  MAP CLICK
// ══════════════════════════════════════════════════════
function applyPickedPoint(lat, lng, zIndexOffset=2000){
  if(pickStep < 0 || pickStep >= pickStepDefs.length) return false;
  qparams[pickStepDefs[pickStep].key] = {lat, lng};
  const cols = ['#e84040', '#f0a030', '#a060ff', '#20c8b0'];
  const m = L.marker([lat, lng], {icon: seekerPin(cols[pickStep % cols.length]), zIndexOffset}).addTo(map);
  seekerPinMarkers.push(m);
  pickStep++;
  if(pickStep >= pickStepDefs.length){
    hideBanner();
    document.getElementById('panel').classList.remove('collapsed');
    const activeType = getActiveBuildQType();
    if(QDEFS[activeType].isReady(qparams)) generateJSON();
  } else {
    showBanner(pickStepDefs[pickStep].label);
  }
  renderBuildBody();
  updatePreview();
  if(typeof maybeAutoResolveBuildQuestion === 'function') maybeAutoResolveBuildQuestion();
  if(qtype === 'thermo') tryGenerate();
  return true;
}

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
  if(pickStep>=0&&pickStep<pickStepDefs.length){
    const {lat,lng}=e.latlng;
    applyPickedPoint(lat, lng);
    return;
  }
  if(handleYellowRegionTap(e.latlng)) return;
  dismissYellowRegionMenu();
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
        const activeType = getActiveBuildQType();
        if(QDEFS[activeType].isReady(qparams)) generateJSON();
      } else {
        showBanner(pickStepDefs[pickStep].label);
      }
      renderBuildBody();
      updatePreview();
      if(typeof maybeAutoResolveBuildQuestion === 'function') maybeAutoResolveBuildQuestion();
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
  currentBuiltQuestion = null;
  if(typeof _tentacleSelection !== 'undefined') _tentacleSelection = null;
  pickStep=-1; pickStepDefs=QDEFS[type].pickSteps;
  clearMarkers(); previewLayer.clearLayers(); simulLayer.clearLayers(); simulMaskLayer.clearLayers();
  if(typeof setPreviewMapMode === 'function') setPreviewMapMode(false);
  document.getElementById('json-out-section').style.display='none';
  document.getElementById('map-simul-bar').classList.remove('visible');
  if(typeof setLoadQuestionPanelOpen === 'function') setLoadQuestionPanelOpen(false);
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
