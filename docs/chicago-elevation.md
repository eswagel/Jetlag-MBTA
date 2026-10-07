# Chicago elevation

Chicago now has an offline terrain grid from USGS 3DEP. It spans the complete game bounds (-88.0 to -87.48 longitude, 41.6 to 42.12 latitude), with 105 × 105 samples spaced 0.005 degrees apart (roughly 400–560 m). Terrain elevation is not building-floor altitude, and the sampled grid cannot resolve every small hill or underpass. The question builder explicitly labels the approximation.

The 65 KB source float TIFF, ArcGIS export response, exact export query, retrieval date, and SHA-256 are checked into `data/chicago/sources`. The server export uses raw F32 values and no rendering function. Those values are meters. The generator divides by 0.3048 to obtain international feet. Pixel centers lie on the game bounds; TIFF north-to-south rows are reversed into the app's south-to-north grid.

## Shared mechanism

The existing entry point remains `node scripts/generate-elevation-grid.js`. Its default Boston path and Boston dataset are unchanged. For any other city, `--city CITY` invokes the shared raster importer, with city-specific source details in `data/CITY/sources/elevation-source.json`. This importer requires Python with Pillow; set `PYTHON` to the desired interpreter if needed.

```
node scripts/generate-elevation-grid.js --city chicago
```

That command is offline and deterministic. `--refresh` explicitly re-exports the source raster and updates its hash; source changes must be reviewed before shipping. A downloaded ArcGIS output URL is ephemeral, so rebuilds use the pinned raster rather than relying on that output URL remaining available.

Runtime behavior is also shared and driven by schema: `pointLookup: "local-grid"` chooses an offline point estimate, and `interpolation: "triangulated-linear"` chooses matching interpolated contours. A future Boston dataset can adopt the same metadata. No Chicago-ID condition selects the algorithm.

Each sampled cell is split on its southwest–northeast diagonal. Both point lookup and threshold contours use the same linear triangles, replacing the old all-or-nothing corner-average cell classification for this dataset. Entirely included cells are joined into runs to limit geometry size. Null, nonnumeric and NODATA values cannot silently become zero elevation. Empty and full elevation answers are represented explicitly rather than treated as a failed overlay.

**Integration requirement:** in `buildMeasureConstraintUnion`, return a `triangulated-linear` elevation feature directly before the legacy `turf.simplify` call. Simplifying its threshold boundary would make it inconsistent with point lookup. The parent integration agent owns that small edit because another agent is editing the function for water.

## Validation and limits

Saved official EPQS spot checks, retrieved October 7, 2026:

| Longitude, latitude | Grid feet | EPQS feet | Difference |
|---|---:|---:|---:|
| -87.63, 41.88 | 593.6581 | 593.6174 | +0.0407 |
| -87.90, 42.00 | 646.9438 | 647.0358 | -0.0920 |
| -87.80, 41.70 | 595.5864 | 601.8083 | -6.2219 |

The third difference demonstrates why this is an approximate exported terrain model, not exact EPQS equivalence or a guaranteed vertical error bound. The app consistently uses the local model for both players' mapped constraints; it makes no network elevation request for this schema.

Tests cover pixel centers, orientation, meters-to-feet conversion, deterministic reconstruction, missing-data rejection, interpolated boundaries, and empty/full constraint application. On this machine, a full-region 593.617-foot contour plus a Turf 7 intersection took about 121 ms with 1,474 polygon pieces. That is a one-run CPU check, not a browser performance guarantee; the integration uses browser Turf 6 and should be checked visually.
