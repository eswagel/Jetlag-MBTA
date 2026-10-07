# Chicago geography

This is a pinned first geography release for the full CTA rail footprint. It supplies real municipal, ward, community area and ZIP tabulation polygons; three river-separated gameplay regions; Lake Michigan shoreline; and regional water edges. It does not yet supply elevation, ordinary POIs or verified Amtrak tracks.

## Runtime contract

Every generated JSON root has `city_id: "chicago"`, `dataset_version: "chicago-v1"`, `geographyVersion: "chicago-geography-v1"`, a gameplay `bbox`, and source provenance.

- `boundaries.json`: `municipalities`, `wards`, `communityAreas`, `postcodes` arrays of `{name, geometry}` Polygon/MultiPolygon records.
- `landmasses.json`: `pieces` of `{id,name,geometry}`; IDs 0 North, 1 West, 2 Loop + South. Geometry lookup is authoritative; no station assignment cache is required.
- `pois.json`: `coastlineLines` and `bodiesOfWaterLines` contain actual GeoJSON line features. `available` lists these keys; `unavailable` lists the empty categories that must be blocked rather than sent to a Boston or generic fallback.
- `elevation-grid.json`: `available: false`, `unavailable: ["elevation"]` and an explanatory `reason`. Never interpret an unavailable grid as zero elevation.

The gameplay envelope is west -88.00, south 41.60, east -87.48, north 42.12. Water reference geography extends to -88.15, 41.45, -87.30, 42.30, beyond the playable footprint.

## Definitions

**Municipalities:** Census BAS 2026 incorporated places intersecting the gameplay envelope, retaining their full polygons. Chicago wards and community areas have no suburban equivalents: an unmatched suburban location means Outside Chicago, not a missing boundary service. All 143 CTA parent station coordinates in the companion transit release match a municipality and a ZCTA; 123 match a Chicago ward and community area, while the same 20 suburban stations match neither.

**Wards:** the City of Chicago's 50 wards effective May 2023 onward (`p293-wvbd`). **Community areas:** the city's 77 published areas (`igwz-8jzy`), with original names. These are not colloquial neighborhood boundaries.

**ZIP codes:** 2020 Census ZIP Code Tabulation Areas, including suburbs. ZCTAs are a consistent polygon proxy for ZIP matching and map filtering; they are not current USPS delivery territories and do not model every unique/PO-box ZIP. The UI must say `ZIP Code (ZCTA)` and explain the definition. Do not mix these polygons with reverse-geocoded postal addresses.

**Landmasses:** full-resolution USGS NHD centerlines partition the envelope along the North Branch, main Chicago River, and South Branch continuing along the Sanitary and Ship Canal. Unnamed artificial-path reaches connect named river reaches; the generator traverses the full hydrographic graph and records exact NHD reach IDs. Only the main river's lakeward endpoint is extended straight through Lake Michigan to the envelope edge. This lake-only gameplay closure must never be used as a shoreline. Smaller tributaries, North Shore Channel, and Des Plaines River do not create additional regions. Bridges and river islands are assigned by this centerline convention, not treated as fourth landmasses. Endpoint/control changes require review when refreshing source data; disconnected paths fail generation.

**Lake Michigan shoreline:** original NHD Lake Michigan polygon boundary, simplified at approximately one meter then clipped to the larger reference envelope. It includes the detailed lakefront harbor outlines represented in that source, but not upstream river banks. It is not an ocean-coastline lookup.

**Bodies of water:** nearest edge of NHD lake/pond (`FTYPE=390`), reservoir (`436`), and mapped stream/river area (`460`) polygons. Contiguous water polygons are merged before their boundaries are extracted, avoiding internal reach seams. Wetlands, treatment areas, and narrow streams without mapped water-area polygons are excluded. This is a defined mapped-water rule; it is not a guarantee that every present-day puddle or small stream has been surveyed. NHD individual features have different historical survey/update dates retained in source properties. Neither retrieval date nor a new build makes them a new survey.

Clipping happens **after** taking actual boundaries and simplifying linework. Tests reject artificial reference-envelope shore segments, including the subtle case where simplifying an already-clipped curve would flatten it onto the frame.

## Reproduce and test offline

Python 3.10+ and Shapely 2.x are required. Install in an isolated virtual environment, e.g. `python3 -m venv /tmp/jetlag-geo-env` then `/tmp/jetlag-geo-env/bin/pip install 'shapely>=2,<3'`.

```sh
/tmp/jetlag-geo-env/bin/python scripts/generate-chicago-geography.py
/tmp/jetlag-geo-env/bin/python tests/chicago-geography.test.py
```

The station coverage test uses `data/chicago/transit.json` after the transit branch is integrated. For isolated branch review, set `JETLAG_TRANSIT_PATH` to that JSON in the transit worktree.

Generation is deterministic from the checked-in gzip source snapshots; no network calls or wall-clock timestamps occur during a build. `sources/manifest.json` records exact public endpoints, query parameters, retrieval dates and SHA-256 hashes of decompressed snapshots. All source features and unrounded original geometries are retained. Paginated NHD sources are concatenated into a FeatureCollection in OBJECTID order, with all pages retained. Regeneration must not silently accept `exceededTransferLimit` or server errors.

For a data refresh, download each manifest query, preserving all pages (NHD server caps pages at 2,000), replace its gzip snapshot, update its decompressed SHA-256 and actual retrieval date, and rerun the generator and tests. Review survey currency, station coverage, river path selection and visual map overlay before bumping the game dataset version. Boundary repair uses Shapely `make_valid` only for source-invalid rings, not smoothing or invented coordinates.

## Sources and attribution

- [Chicago ward polygons](https://data.cityofchicago.org/resource/p293-wvbd.geojson)
- [Chicago community area polygons](https://data.cityofchicago.org/resource/igwz-8jzy.geojson)
- [U.S. Census incorporated places](https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Places_CouSub_ConCity_SubMCD/MapServer/11)
- [U.S. Census 2020 ZCTAs](https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/PUMA_TAD_TAZ_UGA_ZCTA/MapServer/11)
- [USGS National Hydrography Dataset](https://hydro.nationalmap.gov/arcgis/rest/services/nhd/MapServer), layers 6 (flowline), 9 (area), 12 (waterbody).

The snapshots are public government GIS data. Source metadata and attribution are retained; no Overpass/OpenStreetMap data was used in the delivered geography.

## Remaining work

Acquire and validate Chicago elevation. Acquire ordinary POIs with hospitals-only and amusement-parks-only filters (no clinics or arcades). Verify actual Amtrak-used track geometry; generic mainline rail is expressly not an acceptable substitute. These categories remain explicitly unavailable. Metra and South Shore stations are owned by the companion transit dataset. Playtesting, balance and field validation remain outstanding.
