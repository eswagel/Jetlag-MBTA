// Shared UI/runtime helpers for the app shell.

let toastTimer;

function toast(msg, ms = 2400){
  const el = document.getElementById('toast');
  if(!el) return;
  el.textContent = msg;
  el.classList.add('on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('on'), ms);
}

function clearMarkers(){
  pickedMarkers.forEach(m => m.remove());
  pickedMarkers = [];
  seekerPinMarkers.forEach(m => m.remove());
  seekerPinMarkers = [];
  if(thermoHandleMarker){
    thermoHandleMarker.remove();
    thermoHandleMarker = null;
  }
}

function clearPoiMarkers(){
  // Only clear POI teardrops, not the seeker location dot.
  pickedMarkers.forEach(m => m.remove());
  pickedMarkers = [];
  if(thermoHandleMarker){
    thermoHandleMarker.remove();
    thermoHandleMarker = null;
  }
}

function isLatLngLike(value){
  return Number.isFinite(Number(value?.lat)) && Number.isFinite(Number(value?.lng));
}

function normalizeLatLng(value){
  if(!isLatLngLike(value)) return null;
  return {lat:Number(value.lat), lng:Number(value.lng)};
}

function normalizeMatchingBoundaryForCenter(boundary, center){
  if(!boundary || !center) return boundary || null;
  try{
    const pt = turf.point([center.lng, center.lat]);
    let normalized = boundary;
    if(!turf.booleanPointInPolygon(pt, normalized)){
      const bbox = turf.bboxPolygon([-72.5, 41.5, -70.0, 43.0]);
      const flipped = turf.difference(bbox, normalized);
      if(flipped && turf.booleanPointInPolygon(pt, flipped)){
        normalized = flipped;
      }
    }
    return turf.simplify(normalized, {tolerance:0.0005, highQuality:false}) || normalized;
  }catch(e){
    return boundary;
  }
}

function buildStoredQuestionBase(payload, type){
  if(!payload?.id) throw new Error('Question is missing an id');
  if(payload.type !== type) throw new Error(`Expected a ${type} question`);
}

function normKey(value){
  return String(value || '')
    .toLowerCase()
    .replace(/\bcounty\b/g, '')
    .replace(/\b(city|town)\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}
