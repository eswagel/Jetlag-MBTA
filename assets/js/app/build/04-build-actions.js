// Build-mode async selection, generation, and question assembly.

async function selectMatchingCat(catObj){
  if(!qparams.center){ toast('Set your location first'); return; }
  if(catObj.cat === 'landmass' && !_landmassCache.ready){
    toast('⏳ Still loading landmasses — try again in a moment');
    return;
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
        boundary = turf.simplify(boundary, {tolerance:0.0005, highQuality:false});
      }catch(e){ console.warn('Boundary normalize/simplify failed:', e); }
    }
    qparams.matching_boundary = boundary;
    qparams._matching_boundary_simplified = boundary;
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
          const nearestPt = turf.point([pois[0].lng, pois[0].lat]);
          const seekerPt  = turf.point([qparams.center.lng, qparams.center.lat]);
          const correctCell = cells.features.find(cell=>{
            try{ return turf.booleanPointInPolygon(nearestPt, cell); }catch(e){ return false; }
          });
          if(correctCell){
            const seekerInside = (()=>{ try{ return turf.booleanPointInPolygon(seekerPt, correctCell); }catch(e){ return false; }})();
            qparams.nearest_voronoi = seekerInside ? correctCell : null;
            if(!seekerInside) console.warn('Nearest: seeker not in correct Voronoi cell — no zone update');
          }
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
    renderBuildBody();
    tryGenerate();
  }catch(e){
    qparams._nearest_searching=false;
    toast('Search failed: '+e.message);
    renderBuildBody();
  }
}

async function selectMeasureCat(catObj){
  if(!qparams.center){toast('Set your location first');return;}
  qparams._mcat=catObj.label;
  qparams._mcatlabel=catObj.label;
  qparams._msearching=true;
  qparams.measure_cat=catObj.label;
  qparams.measure_cat_label=catObj.label;
  qparams.measure_mode='distance';
  qparams.measure_seeker_nearest=null;
  qparams.measure_seeker_dist=null;
  qparams.measure_seeker_elevation_ft=null;
  qparams.measure_seeker_elevation_m=null;
  qparams.measure_all_instances=null;
  qparams.measure_linear_features=null;
  qparams.measure_constraint_union=null;
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
      renderBuildBody();
      updatePreview();
      tryGenerate();
      return;
    }

    if(['An Amtrak Line','A Coastline'].includes(catObj.label)){
      const lineFeatures = (await getMeasureLinearFeatures(catObj, qparams.center))
        .map(item => ({name:item.name, feature:coerceFeature(item, item.name)}))
        .filter(item => item.feature);
      if(!lineFeatures.length){
        toast(`No ${catObj.label} geometry found`);
        qparams._msearching=false;
        renderBuildBody();
        return;
      }

      const seekerPoint = turf.point([qparams.center.lng, qparams.center.lat]);
      let best = null;
      lineFeatures.forEach(item => {
        try{
          const snapped = turf.nearestPointOnLine(item.feature, seekerPoint, {units:'miles'});
          const dist = snapped?.properties?.dist;
          if(!Number.isFinite(dist)) return;
          if(!best || dist < best.dist){
            const [lng, lat] = snapped.geometry.coordinates;
            best = {name:item.name, lat, lng, dist};
          }
        }catch(e){}
      });
      if(!best){
        toast('Could not determine the nearest Amtrak line');
        qparams._msearching=false;
        renderBuildBody();
        return;
      }

      qparams._msearching=false;
      qparams.measure_seeker_nearest={lat:best.lat,lng:best.lng,name:best.name};
      qparams.measure_seeker_dist=best.dist;
      qparams.measure_linear_features=lineFeatures.map(item => ({
        name:item.name,
        geometry:item.feature.geometry,
      }));
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
      renderBuildBody();
      updatePreview();
      tryGenerate();
      return;
    }

    const instances = await getCategoryInstances(catObj, qparams.center, 35000);
    if(!instances.length){toast('No '+catObj.label+' found nearby');qparams._msearching=false;renderBuildBody();return;}

    instances.sort((a,b)=>turfDist(qparams.center,a)-turfDist(qparams.center,b));
    const nearest=instances[0];
    const dist=turfDist(qparams.center,nearest);

    qparams._msearching=false;
    qparams.measure_seeker_nearest={lat:nearest.lat,lng:nearest.lng,name:nearest.name};
    qparams.measure_seeker_dist=dist;
    qparams.measure_all_instances=instances.slice(0,200);

    clearPoiMarkers();
    const POI_CATS_LINEAR = new Set(['An Amtrak Line','A County Border','A City Border','Sea Level','A Coastline']);
    const isLinear = POI_CATS_LINEAR.has(catObj.label);
    if(isLinear){
      if(catObj.label === 'An Amtrak Line'){
        renderAmtrakMeasureLines(qparams.center, nearest.name);
      }
      const m=L.marker([nearest.lat,nearest.lng],{icon:measurePin(),zIndexOffset:1500}).addTo(map);
      m.bindPopup(measureNearestPopup(catObj.label, nearest.name),{offset:[0,-12],maxWidth:220});
      pickedMarkers.push(m);
    } else {
      instances.slice(0,100).forEach((p,i)=>{
        if(!p.lat||!p.lng) return;
        const col = i===0 ? '#f0a030' : '#4a7090';
        const m = L.marker([p.lat,p.lng],{icon:tentaclePin(i+1,col),zIndexOffset:1500+i})
          .bindPopup(`<div class="stop-popup"><div class="stop-popup-name">${p.name}</div>${i===0?'<div style="font-size:9px;color:#f0a030;margin-top:2px">★ Your nearest</div>':''}</div>`,{offset:[0,-28],maxWidth:220})
          .addTo(map);
        pickedMarkers.push(m);
      });
    }
    if(nearest.lat && nearest.lng){
      const bounds = L.latLngBounds([[nearest.lat,nearest.lng],[qparams.center.lat,qparams.center.lng]]).pad(0.3);
      map.fitBounds(bounds);
    }
    renderBuildBody();
    updatePreview();
    tryGenerate();
  }catch(e){qparams._msearching=false;toast('Search failed: '+e.message);renderBuildBody();}
}

async function selectTentacleCat(catObj){
  if(!qparams.center){toast('Set your location first');return;}
  qparams._tcat=catObj.label;
  qparams._tcatlabel=catObj.label;
  qparams._tsearching=true;
  _tentacleSelection = null;
  _simulActive = null;
  qparams.tentacle_options=null;
  clearPoiMarkers();
  renderBuildBody();
  try{
    const opts = await resolveTentacleQuestionOptions(catObj.label, qparams.center, qparams.radius_miles || 1);
    if(opts.length < 2){
      toast(`Found fewer than 2 ${catObj.label} nearby — try a larger radius`);
      qparams._tsearching=false;
      renderBuildBody();
      return;
    }
    qparams._tsearching=false;
    qparams.tentacle_options=opts;
    renderTentacleOptionPins({
      center:qparams.center,
      radius_miles:qparams.radius_miles || 1,
      options:opts,
      id:currentBuiltQuestion?.id || null,
    }, true);
    renderBuildBody();
    updatePreview();
    tryGenerate();
  }catch(e){qparams._tsearching=false;toast('Search failed: '+e.message);renderBuildBody();}
}

async function resolveTentacleQuestionOptions(categoryLabel, center, radiusMiles=1){
  const catObj = TENTACLES_CATS.find(c => c.label === categoryLabel);
  if(!catObj) throw new Error(`Unknown tentacles category: ${categoryLabel}`);
  const reachMiles = Math.max(0, Number(radiusMiles || 1));
  const searchRadiusMiles = Math.round(reachMiles * 1.5 * 100) / 100;
  const searchRadiusM = Math.round(searchRadiusMiles * 1609.34);
  await loadPoiData();
  const preloaded = getNamedPoiCollection(catObj.label);
  let items = preloaded;
  if(items.length){
    items = items.filter(it => turfDist(center, it) <= searchRadiusMiles);
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
