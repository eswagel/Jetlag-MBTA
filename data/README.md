This directory is reserved for precomputed static datasets used by the app.

Current generated files:

- `mbta-data.json`
- `pois.json`
- `boundaries.json`
- `elevation-grid.json`

Current runtime behavior in `assets/js/app/`:

- MBTA data tries the live MBTA API first and falls back to `mbta-data.json`.
- Other generated files are loaded locally first.
- If a file is missing, the app may fall back to live Overpass / Nominatim requests.
- `landmasses.json` is optional but supported; when present it enables cached landmass lookup state.

Current offline coverage:

- `mbta-data.json` covers the full rapid transit network snapshot plus commuter rail stop points.
- `boundaries.json` currently covers counties and cities/towns that contain at least one playable MBTA stop.
- `pois.json` currently covers the preloaded measure/nearest/tentacle categories, including chain POIs and Amtrak line geometry.
- `elevation-grid.json` stores a coarse cached elevation grid over the playable MBTA area for sea-level questions.
- `landmasses.json` is generated from a Python + Shapely pipeline with cached shoreline/water checkpoints under `data/_cache/` during local generation.

Current live fallbacks that still remain:

- landmass polygons, if `landmasses.json` is absent
- neighborhood matching, if `boundaries.json` does not include neighborhoods
- ZIP/postcode matching, if `boundaries.json` does not include postcodes
