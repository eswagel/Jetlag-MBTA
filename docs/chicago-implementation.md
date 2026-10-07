# Chicago implementation branch

This is the first Chicago implementation, based on `02d4596` and integrated on `feat/chicago-city-profiles`. Boston and the existing manual question/answer exchange remain supported. Sites and shared rooms are deferred.

## Run and check

```sh
npm ci
npm test
python3 -m http.server 8765 --bind 127.0.0.1
```

Open `http://127.0.0.1:8765/?city=chicago` or use the city selector. Browsing city cards updates the launcher in place without reloading the page or creating a game map. Starting a game creates an isolated city session. Boston remains the default for existing links. Node tests use the installed Turf 7 package with binary overlay adapters for the browser's existing Turf 6 interface.

## Implemented

- City profiles own map extents, transit line definitions, labels, paths, and dataset identity.
- Saves are isolated by city. Existing Boston saves migrate on the next save. Questions, answers, and exported logs carry city/version metadata, and incompatible imports are rejected.
- Full CTA rail geometry and 143 parent stations; Green Ashland and Cottage Grove are separate branches with a shared trunk. Metra and South Shore stations are distance references, including stations beyond the play area.
- Municipality, ward, community-area, and ZIP-area matching use local polygons. Outside-Chicago ward/community matching explicitly uses the complement of the Chicago municipal polygon within the game extent.
- ZIP matching uses **2020 Census ZCTAs**, geographic approximations of ZIP delivery areas, not USPS delivery-route polygons. The UI labels this distinction.
- River landmass regions are North, West, and Loop + South. Lake Michigan shoreline measurement uses nearest points on water-edge lines rather than polygon centers. The same distance calculation is implemented for bodies of water, but its question is blocked pending a safe map-filtering algorithm.
- Line questions retain station membership and source-feed hash; importing or resuming never silently reinterprets them using a different CTA feed. Chicago polygon matching avoids the old Boston-specific bounding-box correction and runtime boundary simplification.
- Chicago data paths do not fall back to Boston, generic railway tracks, clinics, or arcades. Missing data cannot silently create a different question.
- All cities share OpenFreeMap's Positron basemap, matching the light visual style of Boston's original CARTO `light_all` layer. The shared Leaflet initializer uses a pinned MapLibre GL renderer and Leaflet adapter; no city-specific provider, API key, registration, or CSS color filter is needed. Basemap vector tiles, fonts, and sprites load online, while game datasets remain local. WebGL is required for the basemap. See https://openfreemap.org/quick_start/.

## Deliberately unfinished

- **Live Purple service:** one Purple line combines local and express patterns, using the saved CTA timetable when live data is unavailable. An optional local server (`python3 scripts/serve-chicago-live.py --port 8765`) proxies official CTA GTFS realtime TripUpdates with `CTA_GTFS_API_KEY` held server-side. No key is configured here, so authenticated live behavior remains unverified. Question snapshots preserve schedule/feed identity and timestamped live evidence, including special stops. The UI distinguishes timetable fallback from live observations combined with timetable assumptions; see `chicago-transit.md`.
- **POI categories:** verified Chicago parks, libraries, hospitals, museums, theaters, consulates, zoos, amusement parks, golf courses, and chain locations still need population and review. Hospitals must exclude clinics; amusement parks must exclude arcades.
- **Amtrak:** actual passenger-used track geometry is still needed. Generic mainline rails are not a fallback.
- **Body of Water map filtering:** exact edge data and nearest-edge calculation are present, but buffering the complete water network exhausted roughly 4 GB of memory in review. This question is blocked in creation, import, replay, and the geometry engine until an efficient bounded implementation is validated. Lake Michigan shoreline buffering passed separately.
- **Elevation:** the label is updated, but a verified Chicago elevation grid is still needed.
- **Game balance and field playtesting:** no real outing has been performed. Source boundary dates, near-river stations, data size on mobile networks, distances, and question usefulness need field review.

## Data and versioning

Source URLs, timestamps/hashes, geometry definitions, coverage and regeneration instructions live in [chicago-transit.md](chicago-transit.md) and [chicago-geography.md](chicago-geography.md). Keep both players on the same generated release. `chicago-v1` is the application dataset release identifier: bump it when changing geographic definitions or releasing refreshed geography, rather than overwriting the meaning of existing questions. Line snapshots additionally pin the exact CTA archive hash. The initial service calendar expires after November 30, 2026; expired schedules return unknown.

## Delegation and review

City-profile UI, transit data/service evaluation, and geographic datasets were developed in separate worktrees. The integration branch cherry-picks reviewed contributions. Independent reviews identified commuter-name deduplication, answered-JSON/import bypasses, missing source-feed identity, and lost ward overlays on restored questions; the integration addresses these with focused regression tests. Worktrees and branches are retained for review.

## City picker and route presentation

`CityPicker` and `CityTransitPreview` build draggable cards from `CITY_PROFILES`; no component enumerates Boston or Chicago. Preview maps allow only land/water layers and reuse the shared transit corridor builder. They capture a still image and release WebGL contexts. Mouse drag, native touch swipe, arrow controls and keyboard navigation are supported. Selecting a card updates the existing cards, setup text, and URL in place. GameSession creates a city-specific document only after Start Game, keeping city-scoped state isolated.

Line definitions separate `physicalLineId` from `branchId`, with optional source aliases and service-pattern dash styles. The corridor renderer coalesces same-line branches and offsets different physical lines in screen pixels, recalculating on zoom. The same model drives the city-card maps. Desktop wheel zoom uses 20 pixels per zoom level instead of Leaflet's default 60; touch pinch is unchanged.
