This directory is reserved for precomputed static datasets used by the app.

Current generated files:

- `mbta-data.json`
- `pois.json`
- `boundaries.json`
- `elevation-grid.json`

Current runtime behavior in `assets/js/app/`:

- Boston rail-only games try the live MBTA API first and fall back to `mbta-data.json`. Games with Silver Line service enabled use the bundled snapshot.
- Other generated files are loaded locally first.
- If a file is missing, the app may fall back to live Overpass / Nominatim requests.
- `landmasses.json` is optional but supported; when present it enables cached landmass lookup state.

Current offline coverage:

- `mbta-data.json` covers the rapid transit network, optional Silver Line services, and commuter rail stop points.
- `boundaries.json` covers counties and cities or towns with a playable MBTA stop, along with Everett and Winthrop, which can be reached within a Silver Line station radius.
- `pois.json` currently covers the preloaded measure/nearest/tentacle categories, including chain POIs and Amtrak line geometry.
- `elevation-grid.json` stores a coarse cached elevation grid over the playable MBTA area for sea-level questions.
- `landmasses.json` is generated from a Python + Shapely offline pipeline that uses hand-drawn region priors plus coastline/river-aware municipal boundaries to refine runtime polygons and stop assignments.

Current live fallbacks that still remain:

- landmass polygons, if `landmasses.json` is absent
- neighborhood matching, if `boundaries.json` does not include neighborhoods
- ZIP/postcode matching, if `boundaries.json` does not include postcodes

Boston's Silver Line stop and route shape data come from the [official MBTA v3 API](https://api-v3.mbta.com/docs/swagger/index.html). The snapshot includes SL1, SL2, SL3, SL4, SL5, and the SLW shuttle. It includes the API's direction-specific geometry and published route variants. Run `npm run generate:mbta -- --silver-only` to refresh these services while retaining the bundled rail snapshot.

The Chelsea, Everett, and Winthrop boundaries come from the [MassGIS Municipalities layer](https://www.mass.gov/info-details/massgis-data-municipalities). They extend the Across the Mystic landmass, and the regenerated station index includes every Silver Line stop. The existing Boston places and elevation datasets cover the full one-mile radius around each of those stops. ZIP code and neighborhood matching in the Silver Line areas still rely on Boston's live geographic lookup.
