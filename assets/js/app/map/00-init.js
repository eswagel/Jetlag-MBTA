// ══════════════════════════════════════════════════════
//  MAP INIT
// ══════════════════════════════════════════════════════
function initMap(){
  map=L.map('map',{center:CENTER,zoom:12,zoomControl:false});

  L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',{
    attribution:'© OpenStreetMap contributors © CARTO',
    subdomains:'abcd', maxZoom:19
  }).addTo(map);

  L.control.zoom({position:'topleft'}).addTo(map);

  // ── Administrative boundary layers (below zone) ──
  countyLayer = L.geoJSON(null,{interactive:false,style:{
    color:'#7799bb', weight:3, fill:false, opacity:0.75, dashArray:'8 5'
  }}).addTo(map);
  townLayer = L.geoJSON(null,{interactive:false,style:{
    color:'#9aaabb', weight:1.5, fill:false, opacity:0.55, dashArray:'4 4'
  }}).addTo(map);
  // Highlight layer — drawn on top of zone layers when a boundary question is active
  boundaryHighlightLayer = L.geoJSON(null,{interactive:false,style:{
    color:'#f0a030', weight:3, fill:false, opacity:0.9
  }});

  // Zone layers behind T lines
  maskLayer  =L.geoJSON(null,{interactive:false,style:{color:'transparent',weight:0,fillColor:'#cc1010',fillOpacity:0.42}}).addTo(map);
  borderLayer=L.geoJSON(null,{interactive:false,style:{color:'#18b050',weight:3,fillColor:'#18b050',fillOpacity:0.10,dashArray:'7 4'}}).addTo(map);

  radiusLayer = L.layerGroup().addTo(map);

  previewLayer=L.geoJSON(null,{interactive:false,style:{color:'#f0a030',weight:1.5,fillColor:'#f0a030',fillOpacity:0.08,dashArray:'4 3'}}).addTo(map);
  tentaclePreviewLayer=L.geoJSON(null,{interactive:false,style:(feature)=>({
    color: feature?.properties?.strokeColor || feature?.properties?.color || '#20c8b0',
    weight: feature?.properties?.weight ?? 2,
    opacity: feature?.properties?.opacity ?? 0.9,
    fillColor: feature?.properties?.fillColor || feature?.properties?.color || '#20c8b0',
    fillOpacity: feature?.properties?.fillOpacity ?? 0.18,
    dashArray: feature?.properties?.dashArray || null,
  })}).addTo(map);
  simulLayer=L.geoJSON(null,{interactive:false,style:{color:'#20c8b0',weight:2,fillColor:'#20c8b0',fillOpacity:0.22}}).addTo(map);
  simulMaskLayer=L.geoJSON(null,{interactive:false,style:{color:'transparent',weight:0,fillColor:'#e84040',fillOpacity:0.18}}).addTo(map);

  renderZone();
  map.on('click',onMapClick);
  loadLandmassData(); // async background load of precomputed landmasses
  loadElevationData();
  loadMBTAData();
  loadAdminBoundaries(); // async background fetch
}

// ══════════════════════════════════════════════════════
//  GOOGLE POLYLINE DECODER
// ══════════════════════════════════════════════════════
function decodePolyline(str){
  let idx=0,lat=0,lng=0,out=[];
  while(idx<str.length){
    let b,shift=0,res=0;
    do{b=str.charCodeAt(idx++)-63;res|=(b&0x1f)<<shift;shift+=5;}while(b>=0x20);
    lat+=((res&1)?~(res>>1):(res>>1));
    shift=0;res=0;
    do{b=str.charCodeAt(idx++)-63;res|=(b&0x1f)<<shift;shift+=5;}while(b>=0x20);
    lng+=((res&1)?~(res>>1):(res>>1));
    out.push([lat/1e5,lng/1e5]);
  }
  return out;
}
