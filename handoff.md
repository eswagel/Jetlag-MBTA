# Jet Lag MBTA Hide & Seek — Current Handoff

## Overview

This repository contains a static browser app for a Boston MBTA version of Jet Lag hide-and-seek.

It is no longer a single giant HTML file:

- `jetlag-mbta.html` is the document shell
- `assets/css/app.css` contains styles
- `assets/js/app/` contains the application JS split by responsibility
- `data/` contains precomputed runtime datasets
- `scripts/` contains generators for those datasets

The app is still build-free at runtime. It can be hosted as plain static files, including on GitHub Pages, as long as the final generated files in `data/` are committed.

## Current Repository State

### Last committed state

Latest commit on `main`:

- `b53729a` — `Add offline data generators and datasets`

That commit added:

- `data/mbta-data.json`
- `data/pois.json`
- `data/boundaries.json`
- `data/landmasses.json`
- generator scripts under `scripts/`
- `.gitignore`
- `package.json` / `package-lock.json`

### Current uncommitted working tree

There are currently local modifications in:

- `assets/js/app/02-map.js`
- `assets/js/app/04-build.js`

Those changes do two things:

1. add `Landmass` as a visible `MATCHING_CATS` option
2. load `landmasses.json` eagerly at startup and change the stale UI wording from "precomputing" to "loading"

These changes are not yet committed.

## Tech Stack

- Vanilla HTML / CSS / JS
- Leaflet 1.9.4
- Turf.js in the browser
- Python 3 + `shapely` for landmass generation
- Node for the other generators and local syntax checking

## Runtime Data Model

The app now prefers precomputed local files first and only falls back live when a file or category is missing.

Runtime files in `data/`:

- `mbta-data.json`
  - full rapid transit line shapes and stops
  - commuter rail stop list
- `pois.json`
  - measure / nearest / tentacle POI categories
  - coastline points
  - Amtrak line geometry
- `boundaries.json`
  - counties
  - cities / towns
  - limited postcode coverage
  - currently no useful neighborhood coverage
- `landmasses.json`
  - currently generated landmass polygons and stop-to-piece assignment

Ignored local-only files:

- `data/_cache/`
- `node_modules/`
- `scripts/__pycache__/`

`data/_cache/` is generation-only checkpoint data and should not be committed.

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
- Matching
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

Landmass work has changed significantly from the original handoff.

### What is true now

- landmasses are no longer live-generated in the browser
- the browser loads `data/landmasses.json`
- there is now a Python landmass generator using `shapely`
- the generator uses checkpointed cache files in `data/_cache/landmasses-v1/`
- the JS/Turf-based landmass generator was kept in the repo but is no longer the preferred path

### Why Python was introduced

The Turf/browser-style approach was too brittle and too slow for:

- coastline polygonization
- splitting by buffered river geometry
- subtracting large sets of water geometry

The Python + Shapely version completes successfully and is materially more reliable.

### Current limitation

The current landmass output is still not semantically correct for the desired gameplay regions.

The current generated `landmasses.json` produces 3 landmasses:

- `North Side / East Boston`
- `Boston / Brookline`
- `Quincy / Braintree`

This is not the desired design.

The desired gameplay landmasses are closer to:

- Cambridge / Somerville
- Everett / East Boston / Revere / Malden
- Boston / Brookline / Newton
- Quincy / Braintree

The user explicitly wants the landmass identity to be reasoned by city / neighborhood, with care for split municipalities such as Boston and Medford, and with important river separators including the Charles, Mystic, and Neponset handled correctly.

This is the biggest current unresolved design issue.

## Boundary Status

`boundaries.json` is partially successful.

### Good

- counties are generated and usable
- cities / towns are generated and usable
- these are enough for most matching and admin-boundary display flows

### Not good enough yet

- neighborhood coverage is effectively missing
- postcode / ZIP coverage is thin and not trustworthy enough

So:

- county matching is mostly offline
- city / town matching is mostly offline
- neighborhood matching still effectively depends on fallback behavior
- ZIP code matching is not production-ready offline

## POI Status

`pois.json` is generated and currently includes:

- parks
- golf courses
- libraries
- hospitals
- medical sites
- museums
- movie theaters
- zoo / aquarium
- foreign consulates
- amusement parks
- Dunkin'
- Starbucks
- CVS
- McDonald's
- gas stations
- bodies of water
- coastline
- Amtrak lines

This is sufficient for the current measure / nearest / tentacle offline-first flows.

## Known Issues

### 1. Landmass grouping is still wrong

This is the most important unresolved correctness issue.

The current generated groups are not the intended gameplay groups. The next implementation should likely stop trying to infer landmasses only from hydrology and instead encode the intended city / neighborhood splits directly.

### 2. Landmass loading feels heavier than it should

Even though the browser is only loading a file now, `landmasses.json` is still larger and more detailed than it needs to be.

Reasons:

- current polygons are still geometry-heavy
- the generator was aimed at "true land pieces" rather than minimal gameplay regions

If landmasses are rewritten as explicit gameplay regions, the final asset can be much smaller and feel instant.

### 3. Neighborhood matching is not solved

The current boundary pipeline does not yet produce a reliable neighborhood dataset.

### 4. ZIP / postcode matching is not solved

The current postcode output is not strong enough to rely on.

### 5. Old landmass code still exists in browser JS

`assets/js/app/04-build.js` still contains the old in-browser `precomputeLandmasses()` implementation, even though the runtime now loads `landmasses.json`.

It is effectively obsolete and should either be removed or clearly quarantined so it does not confuse future work.

### 6. Landmass matching implementation is mid-transition

There are uncommitted changes that expose landmass matching in the UI and load `landmasses.json` eagerly at startup, but the underlying landmass semantics are still wrong.

That means the feature is wired, but not yet final.

## Recommended Next Development Directions

### Highest priority

1. Replace current generated landmasses with explicit gameplay landmasses.
2. Define landmass identity by city / neighborhood rules, with manual exceptions where needed.
3. Regenerate a much smaller `landmasses.json`.

This should likely be done as a rules-driven generator, not another "let hydrology decide everything" pass.

### Likely implementation direction for landmasses

Use:

- city polygons from `boundaries.json`
- explicit Boston sub-area rules
- explicit Medford split rules
- explicit river-based separators for the Charles / Mystic / Neponset where they matter

The goal is not perfect physical geography. The goal is stable and intuitive gameplay regions.

### After that

4. finish neighborhood matching or remove / de-emphasize it if the data remains unreliable
5. improve ZIP handling or remove / de-emphasize it similarly
6. compact final data formats once the logical datasets are stable

## Desired Feature Additions

### Custom boundary drawing

This should be added.

The app should support drawing a custom boundary or region and then applying:

- include only inside the custom boundary
- exclude the custom boundary

This would be useful both as a gameplay / dev tool and as a way to express constraints that do not map cleanly onto the existing canned question types.

This should be called out explicitly in future development planning.

### Landmass UX

Once landmasses are corrected:

- the matching landmass question should remain enabled
- the app should treat landmass data as a normal startup asset
- there should be no "precomputing" language anywhere

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
python3 scripts/generate-landmasses.py
```

Package script:

```bash
npm run generate:landmasses
```

## Bottom Line

This repo is much further along than the original handoff:

- the app is modularized
- offline datasets exist
- runtime no longer depends entirely on live APIs
- the landmass pipeline has been moved to Python

The main remaining correctness problem is that landmass regions are still inferred the wrong way.

The next person should treat landmass generation as a rules / gameplay-definition problem, not just a geometry problem.
