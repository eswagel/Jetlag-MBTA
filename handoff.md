# Jet Lag MBTA Hide & Seek — Claude Code Handoff

## Project Overview

A single-file progressive web app (`jetlag-mbta.html`) that implements a Boston MBTA-based version of the Jet Lag hide & seek game. The hider picks a secret location somewhere on the T network; seekers ask geographic questions to narrow down the zone.

**Stack:** Vanilla HTML/CSS/JS · Leaflet 1.9.4 · Turf.js 6.5.0 · CartoDB Positron tiles  
**APIs used at runtime:** MBTA V3 (`api-v3.mbta.com`), Overpass (`overpass-api.de`), Nominatim (OpenStreetMap geocoding)  
**No backend, no build step** — single HTML file, works as iPhone PWA via Safari "Add to Home Screen"

---

## What's Done

### Game Modes
Three modes selectable at game start:
- **Seeker** — Ask + Apply + Log tabs only
- **Hider** — Answer tab only, prompted to pick their station on map at start
- **Dev** — All tabs, for solo testing

### Map
- CartoDB Positron base tiles (clean, minimal)
- Full MBTA rapid transit network drawn from live MBTA V3 API: Red (Ashmont + Braintree branches drawn separately by terminal latitude), Orange, Blue, Green B/C/D/E, Mattapan
- Red branch shape selection uses shape ID keyword match with terminal-latitude fallback
- Stop markers as SVG icons:
  - Single-line: solid filled circle in line color
  - Multi-line transfer: pie-chart split between distinct colors (Green branches collapsed to one color)
  - Commuter rail interchange: concentric double-ring (inner filled + white gap + outer ring), matching MBTA printed map style
- Commuter rail stops fetched from MBTA V3 API (`route_type=2`) with parent station ID deduplication; double-ring only shown within T network bbox
- Administrative boundaries drawn at startup from Overpass: county (admin_level=6) dashed blue-grey lines, town/city (admin_level=8) lighter thinner lines

### Zone System
- Valid zone starts as union of all stop buffers at chosen hide radius (0.1 / 0.25 / 0.5 / 1.0 mi)
- Red mask overlay = eliminated area; green dashed border = valid zone
- Zone shrinks as questions are answered
- Area display in km², with "X% eliminated" preview when toggling what-if answers

### Question Types

#### 📡 Radar
Seeker picks location + radius. Yes = inside circle (`safeIsect`), No = outside (`safeDiff`).

#### 🌡️ Thermometer
Seeker picks location + travel distance. Closer/further from seeker.

#### 📏 Measure — "Are you closer/further from your nearest ___ than I am from mine?"
Seeker picks location, selects category. App fetches all instances, finds seeker's nearest, bakes `seeker_dist` into JSON. Zone = union of circles of `seeker_dist` around all instances. Hider finds their own nearest from `all_instances` array in JSON.

Categories (grouped):
- **Transit:** Amtrak Line (fetches full route relations by bbox), Commuter Rail Station (from preloaded MBTA data, filtered to T network bbox)
- **Borders:** County Border (OSM admin_level=6 edge points), City Border (admin_level=8 edge points)
- **Natural:** Sea Level (coastline ways densified to points), Body of Water (named water bodies), Coastline (densified)
- **Places of Interest:** Park, Amusement Park, Zoo/Aquarium, Golf Course, Museum, Movie Theater
- **Public Utilities:** Hospital, Library, Foreign Consulate

POI categories show numbered teardrop pins (gold #1 = nearest). Linear/edge categories show a teal diamond at nearest point. Seeker's crosshair dot persists when switching categories.

#### 🐙 Tentacles
Seeker picks location + radius + POI type. App finds all instances within radius, hider answers which they're closest to. Zone = Voronoi cell intersection.

#### 🔗 Matching — two sections in one panel

**"Are we in the same ___?"**  
Reverse-geocodes seeker location, fetches Nominatim boundary polygon, normalizes orientation (checks seeker's point is inside, flips if not), simplifies polygon to avoid mobile freeze. Zone = `safeIsect` (Yes) or `safeDiff` (No).
- County, City/Town, Neighborhood, ZIP Code

**"Is the nearest ___ to me the same as to you?"** (Nearest sub-section)
Seeker picks location + category, app fetches all instances, finds nearest, computes Voronoi cell. Hider GPS-locates and app finds their nearest for auto-answer.
- Park, Golf Course, Library, Hospital, Museum, Movie Theater, Zoo/Aquarium, Foreign Consulate

Relevant boundary questions highlight county or city admin boundaries on map in amber.

#### 📸 Photo
No zone effect. Seeker picks a photo prompt, hider sends photo.

### Hider Flow
- Hider picks their station by tapping the map at game start (station badge shown in Answer tab)
- Station used for identity questions (Matching/Nearest auto-answer)
- Geo questions (Radar, Thermo, Measure, Tentacles) require separate GPS/map location per question
- Auto-answer via GPS for Measure, Matching, Nearest
- Veto and Randomize card support

### Other
- localStorage save/resume
- Answer preview ("what if closer?") with % eliminated display
- Question log tab
- `seekerPinMarkers` separated from `pickedMarkers` so seeker dot persists across POI category changes
- Boundary highlight layer drawn on top when county/city matching/measure question is active

---

## What Needs to Be Done (Offline Precomputation)

This is the main remaining work. Currently several data sources are fetched live on each game load. All of them should be precomputed and saved as static JSON files in the same directory as the HTML.

### 1. `landmasses.json` — T Network Landmass Polygons

**Why:** The "Are we on the same landmass?" question (currently disabled) requires knowing which connected land polygon each T stop is on. This is expensive to compute live (Overpass fetch + Turf difference operations).

**How to build:**
1. Fetch all water bodies in MBTA bbox (`S=41.85, N=42.80, W=-71.70, E=-70.40`) from Overpass:
   - `way["natural"~"^(water|bay|coastline)$"]`
   - `way["waterway"="riverbank"]`
   - `relation["natural"~"^(water|bay)$"]`
   - `relation["waterway"="riverbank"]`
2. Convert way geometries to Turf polygons
3. `land = turf.difference(bboxPolygon, ...all water polys)`
4. Extract MultiPolygon pieces
5. For each T stop in `stopLineMap`, find which piece contains it via `booleanPointInPolygon`
6. **Important:** Check whether the Neponset River separates Quincy from Boston — it may be mapped as a line (`waterway=river`) rather than a polygon (`waterway=riverbank`). If so, buffer river lines by ~30m before differencing.

**Output format:**
```json
{
  "pieces": [
    { "id": 0, "name": "Mainland Boston/Cambridge", "geometry": { "type": "Polygon", "coordinates": [...] } },
    { "id": 1, "name": "East Boston", "geometry": { ... } }
  ],
  "stops": {
    "place-aport": 1,
    "place-mvbcl": 1,
    "place-sstat": 0
  }
}
```

**How to wire back in:** Replace the disabled `precomputeLandmasses()` call with `fetch('landmasses.json')`, populate `_landmassCache.pieces` and `_landmassCache.stopIndex`, set `_landmassCache.ready = true`. Then re-add the Landmass option to `MATCHING_CATS`.

---

### 2. `mbta-data.json` — Full T Network Snapshot

**Why:** Currently the app makes ~10 parallel API calls to MBTA V3 on every load to fetch shapes and stops. This causes a multi-second delay and requires network. The T network changes rarely.

**How to build:**
Replicate what `loadMBTAData()` does, but save the result:
1. For each of the 9 GAME_LINES, fetch:
   - `/shapes?filter[route]=${routeId}` → decode polylines → pick correct branch shape
   - `/stops?filter[route]=${routeId}` → collect stop coordinates, names, IDs
2. Apply the same branch/trunk logic (ASHMONT_ONLY, BRAINTREE_ONLY sets)
3. Also fetch commuter rail stops: `/stops?filter[route_type]=2&page[size]=500`

**Output format:**
```json
{
  "lines": [
    {
      "id": "Red-Ashmont",
      "shapePath": [[42.395, -71.142], ...],
      "stops": [
        { "id": "place-asmnl", "name": "Ashmont", "lat": 42.284652, "lng": -71.063777 }
      ]
    }
  ],
  "commuterRail": [
    { "id": "place-bbsta", "name": "Back Bay", "lat": 42.3478, "lng": -71.0746 }
  ]
}
```

**How to wire in:** Replace `loadMBTAData()` with a `fetch('mbta-data.json')` that populates `stopLineMap`, `allStops`, `commuterRailStops`, `commuterRailStopsList`, then draws everything synchronously. Startup becomes instant and works offline.

---

### 3. `pois.json` — Points of Interest

**Why:** Measure and Nearest questions currently hit Overpass live (slow, unreliable). All the relevant POI categories are static enough to precompute for the Boston metro area.

**How to build:**
For each category, run a broad Overpass query over the T network bbox and save all results:
- Parks: `nwr["leisure"="park"]["name"]`
- Golf courses: `nwr["leisure"="golf_course"]`
- Libraries: `nwr["amenity"="library"]`
- Hospitals: `nwr["amenity"="hospital"]`
- Museums: `nwr["tourism"="museum"]`
- Movie theaters: `nwr["amenity"="cinema"]`
- Zoo/Aquarium: `nwr["tourism"~"^(zoo|aquarium)$"]`
- Foreign consulates: `nwr["office"~"diplomatic|consulate"]`, `nwr["amenity"="embassy"]`
- Amusement parks: `nwr["tourism"="theme_park"]`
- Bodies of water: named water features
- Coastline: densified points from `way["natural"="coastline"]`

**Output format:**
```json
{
  "parks": [{ "name": "Boston Common", "lat": 42.355, "lng": -71.066 }, ...],
  "hospitals": [...],
  "libraries": [...],
  "coastline": [{ "lat": 42.355, "lng": -70.99 }, ...]
}
```

**How to wire in:** In `MEASURE_CATS` and `NEAREST_CATS`, replace `overpass:` functions with `instances: async () => POIS.parks` etc. (loaded at startup from `pois.json`).

---

### 4. `boundaries.json` — Administrative Boundary Polygons

**Why:** Matching questions for county/city currently fetch from Nominatim live. The boundaries never change. Also eliminates the mobile freeze from simplifying large polygons.

**How to build:**
1. Fetch all county (admin_level=6) boundaries in Massachusetts: `relation["admin_level"="6"]["boundary"="administrative"]` for the bbox
2. Fetch all municipality (admin_level=8) boundaries
3. For each, extract the full polygon geometry and simplify with `turf.simplify(tolerance: 0.0005)`
4. Also fetch neighborhood boundaries (admin_level=10) for Boston proper

**Output format:**
```json
{
  "counties": [
    { "name": "Suffolk County", "geometry": { "type": "Polygon", "coordinates": [...] } },
    { "name": "Norfolk County", "geometry": { ... } }
  ],
  "cities": [
    { "name": "Boston", "geometry": { ... } },
    { "name": "Cambridge", "geometry": { ... } }
  ],
  "neighborhoods": [
    { "name": "Back Bay", "geometry": { ... } }
  ]
}
```

**How to wire in:** In `MATCHING_CATS`, replace the Nominatim `resolve` functions with local lookups: reverse-geocode to get the name, then find it in the preloaded boundaries by name match. No more per-question network calls, no polygon normalization needed (precompute with seeker point verified inside), no freeze.

---

## Known Issues / Technical Debt

1. **Overpass reliability** — Overpass is used for Tentacles, Measure (linear categories), and Matching (on-the-fly). It's slow and occasionally down. The `pois.json` precomputation resolves most of this. The remaining live calls would be Tentacles (radius-based from arbitrary point) and border edge points — those are harder to precompute fully.

2. **Commuter rail closer/further logic** — The zone geometry (union of circles around all CR stations at `seeker_dist`) is mathematically correct but the closer/further direction has been confirmed reversed at some point during development. Worth testing carefully with a known case (e.g. seeker at Park St, nearest CR = South Station at ~0.5mi → answer "further" should eliminate everything within 0.5mi of any CR station).

3. **Nominatim boundary orientation** — Nominatim sometimes returns boundary polygons as complements (the world minus the region). There's normalization code that checks `booleanPointInPolygon` and flips if needed. The `boundaries.json` precomputation would eliminate this entirely by verifying once offline.

4. **Neighborhood Matching** — OSM neighborhood boundaries are inconsistent. Some Boston neighborhoods are well-mapped (Back Bay, South End), others aren't closed polygons. `boundaries.json` should document which ones work.

5. **Amtrak track completeness** — The Amtrak query fetches route relations by bbox (`S=41.0, N=43.5`). Check in Overpass Turbo that both the NEC (Boston–Providence) and Downeaster (Boston–Portland) are returned. The fallback uses `way["railway"="rail"]["usage"="main"]` which may include non-Amtrak tracks.

6. **Body of water Measure** — Returns named water body centroids. This works for large bodies (Charles River, Boston Harbor) but small ponds return misleading results. Consider filtering by area in precomputed POIs.

---

## File Structure (Current and Target)

```
jetlag-mbta.html       ← main app (single file, ~3400 lines)

# To be created:
landmasses.json        ← T stop → landmass piece index
mbta-data.json         ← full T network snapshot
pois.json              ← all POIs by category
boundaries.json        ← simplified admin boundary polygons
```

All JSON files should live in the same directory as the HTML. Load them at startup in `initMap()` or early in the page lifecycle, parallel to the existing MBTA API call (or replacing it).

---

## Key Constants and State

```js
// Bounding box for the whole MBTA network
const S=41.85, N=42.80, W=-71.70, E=-70.40;

// T network bbox for CR stop filtering
const T_BBOX = {minLat:42.18, maxLat:42.67, minLng:-71.55, maxLng:-70.85};

// Hide-radius choices (miles)
[0.1, 0.25, 0.5, 1.0]

// GAME_LINES array drives all T line rendering and stop loading
// Red-Ashmont and Red-Braintree are separate entries with branchKeyword

// stopLineMap: { stopId → { name, lat, lng, lines: Set<lineId> } }
// commuterRailStops: Set<stopId> (includes parent station IDs)
// commuterRailStopsList: [{id, name, lat, lng}] (deduplicated by name)
// validZone: Turf GeoJSON polygon — current game zone
// _landmassCache: { ready, pieces[], stopIndex{} }
```