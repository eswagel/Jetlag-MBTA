// Reusable city selection. Profiles supply identity and data; previews know no city names.
class CityTransitPreview {
  static stylePromise;
  static async baseStyle() {
    if (!this.stylePromise) this.stylePromise = fetch('https://tiles.openfreemap.org/styles/positron')
      .then(response => { if (!response.ok) throw new Error('Preview style unavailable'); return response.json(); })
      .catch(error => { this.stylePromise = null; throw error; });
    return this.stylePromise;
  }

  static buildStyle(base, network, profile) {
    const style = structuredClone(base);
    // An allowlist excludes streets, buildings, labels and unrelated railways.
    style.layers = style.layers.filter(layer => layer.type === 'background' ||
      ['water', 'waterway', 'landcover', 'park'].includes(layer['source-layer']));
    const colors = new Map(profile.lines.map(line => [line.id, line.color]));
    const features = network.lines.filter(line => line.shapePath?.length > 1).map(line => ({
      type:'Feature', properties:{color:colors.get(line.id) || line.color || '#658094'},
      geometry:{type:'LineString', coordinates:line.shapePath.map(([lat,lng]) => [lng,lat])},
    }));
    style.sources['city-transit'] = {type:'geojson', data:{type:'FeatureCollection', features}};
    style.layers.push({id:'city-transit',type:'line',source:'city-transit',
      layout:{'line-cap':'round','line-join':'round'},paint:{'line-color':['get','color'],'line-width':2.4}});
    return style;
  }

  constructor(container, profile) { this.container = container; this.profile = profile; }
  async render() {
    if (this.started) return;
    this.started = true;
    let previewMap;
    let timeout;
    try {
      const [base, response] = await Promise.all([CityTransitPreview.baseStyle(), fetch(this.profile.dataFiles.mbta)]);
      if (!response.ok) throw new Error('Transit preview unavailable');
      const style = CityTransitPreview.buildStyle(base, await response.json(), this.profile);
      const coordinates = style.sources['city-transit'].data.features.flatMap(feature => feature.geometry.coordinates);
      if (!coordinates.length) throw new Error('No transit geometry');
      const bounds = coordinates.reduce((bounds, point) => bounds.extend(point), new maplibregl.LngLatBounds());
      const canvasHost = document.createElement('div');
      canvasHost.className = 'city-map-canvas';
      this.container.replaceChildren(canvasHost);
      previewMap = new maplibregl.Map({container:canvasHost,style,interactive:false,attributionControl:false,
        bounds,fitBoundsOptions:{padding:16},canvasContextAttributes:{preserveDrawingBuffer:true}});
      await new Promise((resolve, reject) => {
        previewMap.once('idle', resolve);
        previewMap.once('error', event => reject(event.error));
        timeout = setTimeout(() => reject(new Error('Preview timed out')), 20000);
      });
      const image = document.createElement('img');
      image.alt = '';
      image.src = previewMap.getCanvas().toDataURL('image/png');
      previewMap.remove(); previewMap = null;
      this.container.replaceChildren(image);
      this.container.dataset.ready = 'true';
    } catch (error) {
      this.container.textContent = 'Map preview unavailable';
      this.container.classList.add('unavailable');
      console.warn('City preview:', this.profile.id, error.message);
    } finally {
      clearTimeout(timeout);
      previewMap?.remove();
    }
  }
}

class CityPicker {
  constructor(container, {profiles, selectedId, onSelect}) {
    this.container = container;
    this.profiles = Object.values(profiles);
    this.selectedId = selectedId;
    this.onSelect = onSelect;
    this.render();
  }
  enableDragging() {
    let gesture = null;
    let suppressClickUntil = 0;
    this.track.addEventListener('pointerdown', event => {
      if(event.pointerType === 'touch' || event.button !== 0) return; // Native touch scrolling.
      gesture = {id:event.pointerId, x:event.clientX, scroll:this.track.scrollLeft, dragging:false};
    });
    this.track.addEventListener('pointermove', event => {
      if(!gesture || gesture.id !== event.pointerId) return;
      const delta = event.clientX - gesture.x;
      if(!gesture.dragging && Math.abs(delta) > 6) {
        gesture.dragging = true;
        this.track.setPointerCapture(event.pointerId);
        this.track.classList.add('dragging');
      }
      if(gesture.dragging) {
        event.preventDefault();
        this.track.scrollLeft = gesture.scroll - delta;
      }
    });
    const finish = event => {
      if(!gesture || gesture.id !== event.pointerId) return;
      if(gesture.dragging) suppressClickUntil = performance.now() + 350;
      if(this.track.hasPointerCapture(event.pointerId)) this.track.releasePointerCapture(event.pointerId);
      this.track.classList.remove('dragging');
      gesture = null;
    };
    this.track.addEventListener('pointerup',finish);
    this.track.addEventListener('pointercancel',finish);
    this.track.addEventListener('lostpointercapture',finish);
    this.track.addEventListener('pointerleave',event => { if(gesture && !gesture.dragging) finish(event); });
    this.track.addEventListener('click',event => {
      if(performance.now() < suppressClickUntil) { event.preventDefault(); event.stopPropagation(); }
    },true);
  }
  render() {
    const toolbar = document.createElement('div'); toolbar.className = 'city-picker-toolbar';
    const label = document.createElement('span'); label.className = 'setup-section-label'; label.id = 'city-picker-label'; label.textContent = 'Choose your city';
    const controls = document.createElement('div'); controls.className = 'city-picker-controls';
    this.track = document.createElement('div'); this.track.className = 'city-card-track';
    this.enableDragging();
    this.track.setAttribute('role','group'); this.track.setAttribute('aria-labelledby',label.id);
    this.cards = this.profiles.map(profile => {
      const card = document.createElement('button'); card.type = 'button'; card.className = 'city-card'; card.dataset.city = profile.id;
      const selected = profile.id === this.selectedId;
      card.setAttribute('aria-pressed',String(selected));
      card.setAttribute('aria-label',`${profile.name}, ${profile.networkLabel}`);
      const heading = document.createElement('div'); heading.className = 'city-card-heading';
      const title = document.createElement('strong'); title.textContent = profile.name;
      const agency = document.createElement('span'); agency.className = 'city-card-agency'; agency.textContent = profile.networkLabel;
      const state = document.createElement('span'); state.className = 'city-card-state'; state.textContent = selected ? '✓ Selected' : 'Select city';
      heading.append(title,agency,state);
      const canvas = document.createElement('div'); canvas.className = 'city-card-map'; canvas.setAttribute('aria-hidden','true'); canvas.textContent = 'Loading map…';
      card.append(heading,canvas); card.addEventListener('click',()=>this.onSelect(profile.id));
      card.preview = new CityTransitPreview(canvas,profile);
      card.addEventListener('keydown',event => {
        const index = this.cards.indexOf(card);
        const next = event.key === 'ArrowRight' ? index+1 : event.key === 'ArrowLeft' ? index-1 : event.key === 'Home' ? 0 : event.key === 'End' ? this.cards.length-1 : null;
        if(next === null) return;
        event.preventDefault();
        this.cards[Math.max(0,Math.min(this.cards.length-1,next))].focus();
      });
      this.track.append(card); return card;
    });
    const makeArrow = (name, text, direction) => {
      const button = document.createElement('button'); button.type = 'button'; button.textContent = text; button.setAttribute('aria-label',name);
      button.addEventListener('click',()=>this.track.scrollBy({left:direction*this.cards[0].offsetWidth,behavior:matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto':'smooth'}));
      controls.append(button); return button;
    };
    this.previous = makeArrow('Previous cities','←',-1);
    this.next = makeArrow('Next cities','→',1);
    toolbar.append(label,controls);
    const attribution = document.createElement('div'); attribution.className = 'city-preview-attribution';
    attribution.innerHTML = '<a href="https://openfreemap.org/">OpenFreeMap</a> · <a href="https://openmaptiles.org/">OpenMapTiles</a> · © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';
    this.container.replaceChildren(toolbar,this.track,attribution);
    const updateControls = () => {
      this.previous.disabled = this.track.scrollLeft < 2;
      this.next.disabled = this.track.scrollLeft + this.track.clientWidth >= this.track.scrollWidth-2;
    };
    this.track.addEventListener('scroll',updateControls,{passive:true});
    this.resizeObserver = new ResizeObserver(updateControls); this.resizeObserver.observe(this.track);
    this.observer = new IntersectionObserver(entries => entries.forEach(entry => {
      if(entry.isIntersecting) { entry.target.preview.render(); this.observer.unobserve(entry.target); }
    }),{root:this.track});
    this.cards.forEach(card=>this.observer.observe(card));
    requestAnimationFrame(()=>{
      const active = this.cards.find(card=>card.dataset.city===this.selectedId);
      if(active) this.track.scrollLeft = active.offsetLeft - 3;
      updateControls();
    });
  }
}
