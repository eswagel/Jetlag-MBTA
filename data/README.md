This directory is reserved for precomputed static datasets used by the app.

Planned files from the current handoff:

- `landmasses.json`
- `mbta-data.json`
- `pois.json`
- `boundaries.json`

Current runtime behavior in `assets/js/app/`:

- The app tries these local files first.
- If a file is missing, it falls back to the live MBTA / Overpass / Nominatim requests.
- `landmasses.json` is optional but supported; when present it enables cached landmass lookup state.
