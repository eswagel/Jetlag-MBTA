# Chicago local points of interest

Chicago's POI questions use the bundled `data/chicago/pois.json`; playing never queries Overpass. The generator reads a dated Illinois OpenStreetMap extract from Geofabrik. The compact, checked-in `data/chicago/sources/poi-osm.json.gz` retains qualifying source IDs, tags and centers, together with the upstream URL and SHA-256. It is sufficient to reproduce the category arrays offline.

The selectors are shared with Boston in `scripts/lib/poi-categories.json`. Boston's Overpass generator compiles them to query syntax; Chicago's extract reader evaluates the same definitions against tags, with explicit Chicago overrides. Existing Boston category semantics remain unchanged.

## Regeneration

From the checked-in source snapshot, with standard Python only:

```sh
python3 scripts/generate-chicago-pois.py
python3 tests/chicago-pois.test.py
node --test tests/poi-categories.test.cjs
```

To refresh the upstream extract, install `osmium==4.3.1` in an isolated environment, download a dated Illinois `.osm.pbf` from `https://download.geofabrik.de/north-america/us/`, then run:

```sh
python3 scripts/generate-chicago-pois.py --pbf /path/to/illinois-261006.osm.pbf --source-url https://download.geofabrik.de/north-america/us/illinois-261006.osm.pbf
```

The large PBF stays outside the repository. The generator updates only the POI category arrays, availability lists, and `sources.poi-osm`; water, shoreline, Amtrak and other source metadata survive regeneration.

## Definitions and limits

- Extent: west −88.15, south 41.45, east −87.30, north 42.30. This is the padded reference-data extent used by Chicago water/coastline data, beyond the CTA playing area, including Evanston and Oak Park. It does not change the playable boundary. The source is the Illinois extract: the rectangle is a selection bound, not a claim of Indiana or Wisconsin coverage.
- Hospitals require `amenity=hospital`; when a healthcare tag is present it must also say hospital, so clinics and psychotherapy practices are excluded. Chicago's legacy `medicalSites` alias uses the same hospital-only set.
- Amusement parks require `tourism=theme_park`; arcades are excluded. Zoos/aquariums, museums, cinemas, libraries, named parks, golf courses and fuel stations use their corresponding OSM facility tags. Foreign consulates require an explicit consulate tag, not generic diplomatic offices.
- Chain categories require both an appropriate active business type and matching brand/name. Disused, abandoned and demolished features are excluded.
- Nodes retain their mapped location. Ways and multipolygon relations use bounding-box centers, matching the existing Boston `out center` convention. These are facility reference points, not entrances or nearest polygon edges.
- Same-name node/area representations less than 75 meters apart are collapsed deterministically. This does not guarantee all duplicate campuses are merged or every real-world facility is mapped.
- `available` means populated from this source, not a complete official directory. OSM omissions, incorrect tags, and stale business listings remain possible. Empty categories stay unavailable.

Data attribution: © OpenStreetMap contributors, ODbL 1.0, https://www.openstreetmap.org/copyright. Extract provider: Geofabrik, https://download.geofabrik.de/.
