// Build-mode panel rendering and local interaction helpers.

function renderBuildBody(){
  _clearClicks();
  const el = document.getElementById('build-body');
  if(!qtype){ el.innerHTML='<p class="empty" style="margin-top:8px">Choose a question type above to get started.</p>'; return; }
  let h = '';

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
    if(pickStep >= pickStepDefs.length){
      h += `<button class="btn btn-ghost" style="margin-bottom:8px;margin-top:4px" onclick="restartPick()">↺ Re-pick Points</button>`;
    }
  }

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
  if(isCustom||qparams._customR){
    h+=`<div class="param"><div class="plabel">Miles</div>
    <input type="number" min="0.1" step="0.1" value="${qparams.radius_miles||0.5}" style="width:80px"
    oninput="const v=+this.value;if(v>0){setParam('radius_miles',v);updatePreview();tryGenerate();}"></div>`;
  }
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
  } else if(qparams.matching_seeker_val){
    const hasBoundary = !!qparams.matching_boundary;
    h += `<div class="found-result" style="margin-top:8px">
      <b>${qparams.matching_cat_label}:</b> ${qparams.matching_seeker_val}
      <div style="font-size:8px;color:${hasBoundary?'var(--green)':'var(--gold)'};margin-top:4px">
        ${hasBoundary ? '✓ Boundary loaded — zone will update on answer' : '⚠ No boundary — informational only'}
      </div>
    </div>`;
  }

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

function restartPick(){
  QDEFS[qtype].pickSteps.forEach(s=>delete qparams[s.key]);
  if(qtype === 'thermo') delete qparams.thermo_dest;
  clearMarkers();
  previewLayer.clearLayers();
  pickStep=0;
  document.getElementById('json-out-section').style.display='none';
  showBanner(pickStepDefs[0].label);
  document.getElementById('panel').classList.add('collapsed');
  renderBuildBody();
}
