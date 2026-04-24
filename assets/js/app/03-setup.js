// ══════════════════════════════════════════════════════
//  SETUP SCREEN
// ══════════════════════════════════════════════════════
function selectRadius(el){
  document.querySelectorAll('.radius-opt').forEach(o=>o.classList.remove('selected'));
  el.classList.add('selected');
  hideRadiusMi = parseFloat(el.dataset.mi);
  _hideRadiusZoneCache = { miles: null, stopCount: 0, zone: null };
  if(typeof resetStopRegionCache === 'function') resetStopRegionCache();
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

let _hideRadiusZoneCache = { miles: null, stopCount: 0, zone: null };
let _pendingYellowRegionFeature = null;
let _yellowMultiSelectActive = false;
let _yellowSelectedFeatures = [];

function canSelectYellowRegions(){
  const setupOverlay = document.getElementById('setup-overlay');
  if(setupOverlay && !setupOverlay.classList.contains('hidden')) return false;
  if(_pickingHiderStation) return false;
  if(typeof _hiderPickingLocation !== 'undefined' && _hiderPickingLocation) return false;
  if(qtype === 'custom_boundary' && qparams._drawingBoundary) return false;
  if(pickStep >= 0 && pickStep < pickStepDefs.length) return false;
  return !!stopRegionState?.yellowFeatures?.length;
}

function findYellowRegionFeatureAtLatLng(latlng){
  if(!canSelectYellowRegions()) return null;
  const pt = turf.point([latlng.lng, latlng.lat]);
  return (stopRegionState?.yellowFeatures || []).find(feature => {
    try{ return turf.booleanPointInPolygon(pt, feature); }
    catch(e){ return false; }
  }) || null;
}

function dismissYellowRegionMenu(){
  _pendingYellowRegionFeature = null;
  if(map) map.closePopup();
}

function yellowFeatureKey(feature){
  return JSON.stringify(feature?.geometry || feature);
}

function isYellowFeatureSelected(feature){
  const key = yellowFeatureKey(feature);
  return _yellowSelectedFeatures.some(item => yellowFeatureKey(item) === key);
}

function updateYellowSelectionOverlay(){
  if(tentaclePreviewLayer) tentaclePreviewLayer.clearLayers();
  if(yellowSelectLayer) yellowSelectLayer.clearLayers();

  const yellowFeatures = stopRegionState?.yellowFeatures || [];
  if(_yellowMultiSelectActive && yellowSelectLayer && yellowFeatures.length){
    yellowSelectLayer.addData(turf.featureCollection(yellowFeatures));
    if(yellowSelectLayer.bringToFront) yellowSelectLayer.bringToFront();
  }

  if(!tentaclePreviewLayer || !_yellowSelectedFeatures.length) return;
  tentaclePreviewLayer.addData({
    type:'FeatureCollection',
    features:_yellowSelectedFeatures.map(feature => ({
      ...cloneGeo(feature),
      properties:{
        ...(feature.properties || {}),
        color:'#ffcf5a',
        strokeColor:'#ffcf5a',
        fillColor:'#ffcf5a',
        fillOpacity:0.38,
        weight:3,
        opacity:1,
      },
    })),
  });
}

function getYellowRegionCount(){
  return stopRegionState?.yellowFeatures?.length || 0;
}

function updateYellowReviewBar(){
  const bar = document.getElementById('yellow-review-bar');
  if(!bar) return;
  const count = getYellowRegionCount();
  if(!count){
    bar.classList.remove('visible');
    bar.innerHTML = '';
    if(_yellowMultiSelectActive) cancelYellowMultiSelect();
    return;
  }
  const selected = _yellowSelectedFeatures.length;
  if(_yellowMultiSelectActive){
    bar.innerHTML = `
      <span class="yr-count">${selected || 0} selected</span>
      <button class="yr-btn primary" type="button" onclick="finishYellowMultiSelect()" ${selected ? '' : 'disabled'}>Make red</button>
      <button class="yr-btn" type="button" onclick="selectAllYellowRegions()">Select all</button>
      <button class="yr-btn" type="button" onclick="cancelYellowMultiSelect()">Cancel</button>
    `;
  }else{
    bar.innerHTML = `
      <span class="yr-count">${count} temporary</span>
      <button class="yr-btn primary" type="button" onclick="startYellowMultiSelect()">Select</button>
      <button class="yr-btn danger" type="button" onclick="hardenAllYellowRegions()">All red</button>
    `;
  }
  bar.classList.add('visible');
}

function buildYellowHardenBoundary(features){
  let union = null;
  features.forEach(feature => { union = unionGeo(union, feature); });
  return union;
}

function hardenYellowFeatures(features){
  const chosen = (features || []).filter(Boolean);
  if(!chosen.length) return;
  const boundary = buildYellowHardenBoundary(chosen);
  if(!boundary){ toast('Could not read selected yellow region'); return; }
  const count = chosen.length;
  const prevZone = validZone ? cloneGeo(validZone) : null;
  const prevStopRegionState = stopRegionState ? cloneForStorage(stopRegionState) : null;
  const selectedYellow = chosen.map(feature => ({
    stop_id: feature?.properties?.stopId || null,
    geometry_key: yellowFeatureKey(feature),
  })).filter(item => item.stop_id && item.geometry_key);
  constraints.push({
    type:'_yellow_harden',
    boundary_geojson: boundary,
    selected_yellow:selectedYellow,
    _label: count === 1 ? 'Yellow region made red' : `${count} yellow regions made red`,
  });
  if(syncZoneStateFromConstraints()){
    _yellowMultiSelectActive = false;
    _yellowSelectedFeatures = [];
    updateYellowSelectionOverlay();
    renderZone();
    renderLog();
    saveGame();
    toast(count === 1 ? 'Yellow region made red' : `${count} yellow regions made red`);
  }else{
    constraints.pop();
    validZone = prevZone;
    stopRegionState = prevStopRegionState;
    toast('Could not make yellow region red');
  }
}

function hardenPendingYellowRegion(){
  if(!_pendingYellowRegionFeature) return;
  const feature = cloneGeo(_pendingYellowRegionFeature);
  dismissYellowRegionMenu();
  hardenYellowFeatures([feature]);
}

function startYellowMultiSelect(){
  if(!canSelectYellowRegions()) return;
  _yellowMultiSelectActive = true;
  _yellowSelectedFeatures = _pendingYellowRegionFeature ? [cloneGeo(_pendingYellowRegionFeature)] : [];
  _pendingYellowRegionFeature = null;
  dismissYellowRegionMenu();
  updateYellowSelectionOverlay();
  updateYellowReviewBar();
}

function toggleYellowRegionSelection(feature){
  const key = yellowFeatureKey(feature);
  const existing = _yellowSelectedFeatures.findIndex(item => yellowFeatureKey(item) === key);
  if(existing >= 0 && _yellowSelectedFeatures.length > 1) _yellowSelectedFeatures.splice(existing, 1);
  else if(existing < 0){
    _yellowSelectedFeatures.push(cloneGeo(feature));
  }
  updateYellowSelectionOverlay();
  updateYellowReviewBar();
}

function finishYellowMultiSelect(){
  const selected = _yellowSelectedFeatures.map(cloneGeo);
  hideBanner();
  dismissYellowRegionMenu();
  hardenYellowFeatures(selected);
}

function cancelYellowMultiSelect(){
  _yellowMultiSelectActive = false;
  _yellowSelectedFeatures = [];
  updateYellowSelectionOverlay();
  hideBanner();
  dismissYellowRegionMenu();
  updateYellowReviewBar();
}

function selectAllYellowRegions(){
  if(!_yellowMultiSelectActive) return;
  _yellowSelectedFeatures = (stopRegionState?.yellowFeatures || []).map(cloneGeo);
  updateYellowSelectionOverlay();
  updateYellowReviewBar();
}

function hardenAllYellowRegions(){
  const features = stopRegionState?.yellowFeatures || [];
  if(!features.length) return;
  const ok = window.confirm(`Make all ${features.length} temporary region${features.length === 1 ? '' : 's'} red?`);
  if(!ok) return;
  hardenYellowFeatures(features);
}

function openYellowRegionMenu(latlng, feature){
  if(!map || !feature) return;
  _pendingYellowRegionFeature = cloneGeo(feature);
  L.popup({closeButton:true, autoPan:true, offset:[0, -4]})
    .setLatLng(latlng)
    .setContent(`
      <div class="stop-popup">
        <div class="stop-popup-name">Yellow Region</div>
        <div style="font-size:9px;color:var(--dim);line-height:1.55">
          This area is ruled out right now, but the stop is still possible. You can make it red permanently.
        </div>
        <button class="btn btn-red yellow-region-menu-btn" type="button" onclick="hardenPendingYellowRegion()">Make this red</button>
        <button class="btn btn-ghost yellow-region-menu-btn" type="button" onclick="startYellowMultiSelect()">Select on map</button>
      </div>
    `)
    .openOn(map);
}

function handleYellowRegionTap(latlng){
  const feature = findYellowRegionFeatureAtLatLng(latlng);
  if(!feature) return false;
  if(_yellowMultiSelectActive){
    toggleYellowRegionSelection(feature);
    return true;
  }
  openYellowRegionMenu(latlng, feature);
  return true;
}

function handleYellowSelectionFeatureClick(feature){
  if(!_yellowMultiSelectActive) return;
  toggleYellowRegionSelection(feature);
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
  syncZoneStateFromConstraints();
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
  if(softLayer) softLayer.clearLayers();
  borderLayer.clearLayers();
  dismissYellowRegionMenu();
  if(!validZone) return;
  const hard = stopRegionState?.hardUnion || validZone;
  const greenDisplay = stopRegionState ? stopRegionState.greenUnion : hard;
  const yellowDisplay = stopRegionState?.yellowUnion || null;
  const maskBase = INIT_POLY;

  try{ const mask=exactDiff(maskBase, hard); if(mask) maskLayer.addData(mask); }catch(e){}
  if(yellowDisplay && softLayer) softLayer.addData(yellowDisplay);
  if(greenDisplay) borderLayer.addData(greenDisplay);
  updateYellowSelectionOverlay();
  updateStat();
  updateYellowReviewBar();
}

function updateStat(){
  const hard = stopRegionState?.hardUnion || validZone;
  const km2=hard?(turf.area(hard)/1e6).toFixed(1):'0';
  document.getElementById('zone-stat').textContent=`${km2} km²`;
  document.getElementById('zone-area').textContent=`${km2} km² in play`;
}

function resetZone(){
  applyHideRadius();
  clearSave();
  cancelYellowMultiSelect();
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
  if(handleYellowRegionTap(e.latlng)) return;
  if(pickStep<0||pickStep>=pickStepDefs.length) return;
  const {lat,lng}=e.latlng;
  applyPickedPoint(lat, lng);
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
