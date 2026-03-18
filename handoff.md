# Jet Lag MBTA Hide & Seek — Current Handoff

## Overview

This repository contains a static browser app for a Boston MBTA version of Jet Lag hide-and-seek.

- `index.html` is the document shell
- `assets/css/app.css` contains styles
- `assets/js/app/` contains the application JS split by responsibility
- `data/` contains precomputed runtime datasets
- `scripts/` contains generators for those datasets

The app is build-free at runtime. It must be served over HTTP (not opened directly as a `file://` URL) because all data files are loaded via `fetch()`. Use `py -m http.server 8080` or `npx serve .` for local development.

## Current Repository State

### Committed state

Latest commit on `main`: `3386c6d` — `Update project handoff`

### Uncommitted working tree

Three files are modified:

- `scripts/generate-landmasses.py` — fully rewritten (see below)
- `data/landmasses.json` — regenerated from the new script
- `assets/js/app/02-map.js` — one-line fix: `loadLandmassData()` now calls `renderBuildBody()` after the async load completes so the ⏳ loading badge clears automatically

These changes are not yet committed.

## Tech Stack

- Vanilla HTML / CSS / JS
- Leaflet 1.9.4
- Turf.js in the browser
- Python 3 + `shapely` for landmass generation
- Node for the other generators and local syntax checking

## Runtime Data Model

Runtime files in `data/`:

- `mbta-data.json` — full rapid transit line shapes and stops; commuter rail stop list
- `pois.json` — measure / nearest / tentacle POI categories; coastline points; Amtrak line geometry
- `boundaries.json` — counties; cities / towns; limited postcode coverage
- `landmasses.json` — gameplay landmass polygons and stop-to-region assignment

Ignored local-only files:

- `data/_cache/` — generation-only checkpoint data, should not be committed
- `node_modules/`
- `scripts/__pycache__/`

## What Works

### Core gameplay

- setup flow with hide radius
- seeker / hider / dev modes
- map rendering with MBTA network and stop icons
- zone masking and shrinking
- save / resume
- question log
- hider station selection and auto-answer flows

### Question types

- Radar
- Thermometer
- Measure
- Tentacles
- Matching (including Landmass — wired and loading correctly)
- Nearest
- Photo

### Offline-first data paths

- MBTA network loads from `data/mbta-data.json`
- POI-backed questions load from `data/pois.json`
- county / city matching loads from `data/boundaries.json`
- landmass data loads from `data/landmasses.json`

### Generator scripts

- `scripts/generate-mbta-data.js`
- `scripts/generate-pois.js`
- `scripts/generate-boundaries.js`
- `scripts/generate-landmasses.py`

There is also a shared shoreline helper used by the JS coastline path:

- `scripts/lib/shoreline.js`

## Landmass Status

### What was done this session

The old landmass generator (hydrology-based, fetching coastline and water ways from Overpass and subtracting them) was thrown out and replaced with a rules-driven approach:

1. Load city polygons from `boundaries.json`
2. Union city polygons per gameplay region
3. Assign stops by point-in-polygon
4. Apply a hardcoded `STOP_OVERRIDES` table for stops whose city doesn't match their intended region

The new generator is `scripts/generate-landmasses.py`. The config lives at the top of the file and is easy to edit.

### Desired gameplay regions

The four intended regions are:

| ID | Name | Cities | Key overrides |
|---|---|---|---|
| 0 | Cambridge / Somerville / Charlestown | Cambridge, Somerville | Community College, Sullivan Square, Medford/Tufts, Ball Square |
| 1 | Everett / East Boston / Revere / Malden | Malden, Medford, Revere | Suffolk Downs, Orient Heights, Wood Island, Airport, Maverick → 1; Community College, Sullivan Square, Medford/Tufts → 0 |
| 2 | Boston / Brookline / Newton | Boston, Brookline, Newton, Milton | — |
| 3 | Quincy / Braintree | Quincy, Braintree | — |

### Current stop assignments

Region 0 (16 stops): Alewife, Assembly, Ball Square, Central, Community College, Davis, East Somerville, Gilman Square, Harvard, Kendall/MIT, Lechmere, Magoun Square, Medford/Tufts, Porter, Sullivan Square, Union Square

Region 1 (11 stops): Airport, Beachmont, Malden Center, Maverick, Oak Grove, Orient Heights, Revere Beach, Suffolk Downs, Wellington, Wonderland, Wood Island

Region 2 (93 stops): all core Boston/Brookline/Newton network

Region 3 (5 stops): Braintree, North Quincy, Quincy Adams, Quincy Center, Wollaston

### Known remaining problem

The stop assignments are correct but the **display polygons are wrong**.

The region geometry for region 0 is the union of the Cambridge and Somerville city polygons from `boundaries.json`. Charlestown is not a separate city in that dataset — it is part of the Boston city polygon. So the displayed region 0 polygon does not include Charlestown geographically, even though Community College and Sullivan Square are assigned to it.

Concretely: if a seeker clicks near Community College, the app finds the nearest stop (Community College, region 0), then draws the Cambridge/Somerville polygon as the highlighted region. That polygon does not visually cover Charlestown. The answer logic is correct; the visual is wrong.

The same structural issue affects region 1: the displayed polygon is the union of Malden + Medford + Revere city polygons. It correctly covers the Orange Line north of the Mystic and most of the Blue Line corridor, but it does not include the East Boston portion of Boston geographically — only the stop assignments put those stops in region 1.

### Why this is hard to fix cleanly

`boundaries.json` does not have neighborhood-level polygons for Boston. The Boston entry is one large city polygon covering all Boston neighborhoods including Charlestown, East Boston, Dorchester, Roxbury, etc. There is no Charlestown polygon or East Boston polygon to union into the correct region.

### Recommended next step

The display polygons need to be defined explicitly, not inferred from city unions. Two options:

**Option A — Hand-define region polygons as GeoJSON**

Draw four polygons in geojson.io (or similar) that cover the intended regions. Store them in the generator config. Use them as the display geometry directly; still use point-in-polygon + stop overrides for stop assignment.

This is the most straightforward path. The polygons do not need to be precise administrative boundaries — they just need to cover the right stops for visual purposes.

**Option B — Clip Boston polygon by river geometry**

Fetch the Mystic River and Inner Harbor geometries and use them to cut the Boston city polygon into Charlestown, East Boston, and remaining Boston sub-polygons. Then reassign those sub-polygons to the correct regions.

This is more automated but reintroduces the complexity of the old hydrology approach, just more targeted.

Option A is recommended. The regions are stable and the polygon shapes are simple enough to draw by hand in under 10 minutes.

## Boundary Status

`boundaries.json` is partially successful.

### Good

- counties are generated and usable
- cities / towns are generated and usable
- these are enough for most matching and admin-boundary display flows

### Not good enough yet

- neighborhood coverage is effectively missing
- postcode / ZIP coverage is thin and not trustworthy enough

## POI Status

`pois.json` is generated and currently includes:

- parks, golf courses, libraries, hospitals, medical sites, museums, movie theaters
- zoo / aquarium, foreign consulates, amusement parks
- Dunkin', Starbucks, CVS, McDonald's, gas stations
- bodies of water, coastline, Amtrak lines

## Known Issues

### 1. Landmass display polygons do not cover all assigned stops

This is the current most important open issue. Described in detail above.

### 2. Old in-browser landmass precompute code still exists

`assets/js/app/04-build.js` still contains `precomputeLandmasses()`, which was the original live Overpass-based generator. It is dead code — nothing calls it. It should be removed to avoid confusion.

### 3. Neighborhood matching is not solved

The current boundary pipeline does not produce a reliable neighborhood dataset.

### 4. ZIP / postcode matching is not solved

The current postcode output is not strong enough to rely on.

## Desired Feature Additions

### Custom boundary drawing

The app should support drawing a custom boundary or region and applying:

- include only inside the custom boundary
- exclude the custom boundary

Useful both as a gameplay/dev tool and for expressing constraints not covered by canned question types.

## Useful Commands

Syntax checks:

```bash
node --check assets/js/app/01-core.js
node --check assets/js/app/02-map.js
node --check assets/js/app/04-build.js
python3 -m py_compile scripts/generate-landmasses.py
```

Generator commands:

```bash
node scripts/generate-mbta-data.js
node scripts/generate-pois.js
node scripts/generate-boundaries.js
py -3 scripts/generate-landmasses.py   # note: python3 alias may not exist on Windows
```

Local development server (required — app does not work over file://):

```bash
py -m http.server 8080
# open http://localhost:8080/
```

Package script:

```bash
npm run generate:landmasses
```

## Bottom Line

The landmass question is wired and loading correctly. Stop assignments match the intended gameplay regions. The remaining problem is purely visual: the displayed region polygons are city unions that don't cover Charlestown or East Boston because those are sub-areas of the Boston city polygon, not separate cities in `boundaries.json`.

The next person should implement Option A above: hand-define four simple display polygons in the generator config and use those instead of city unions. Stop assignment logic (point-in-polygon + overrides) can stay as-is or be simplified further once the display polygons are correct.
