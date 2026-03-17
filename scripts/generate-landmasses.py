#!/usr/bin/env python3
"""
Generate runtime landmass data from hand-drawn gameplay regions.

Input:
- data/landmass-regions.geojson
  Contains three polygons:
  - Across the Mystic
  - Across the Charles
  - Across the Neponset

Output:
- data/landmasses.json
  Contains those three regions plus a synthetic Mainland Boston fallback
  and a stop -> region assignment map for the browser app.
"""

import json
from datetime import UTC, datetime
from pathlib import Path

from shapely.geometry import GeometryCollection, MultiPolygon, Point, Polygon, mapping, shape
from shapely.ops import unary_union

ROOT = Path(__file__).resolve().parent.parent
BOUNDARIES = ROOT / "data" / "boundaries.json"
MBTA_DATA = ROOT / "data" / "mbta-data.json"
SOURCE = ROOT / "data" / "landmass-regions.geojson"
OUTPUT = ROOT / "data" / "landmasses.json"

SIMPLIFY_TOLERANCE = 0.0003
MAINLAND_ID = 3
MAINLAND_NAME = "Mainland Boston"
EXPECTED_SOURCE_REGIONS = [
    {"id": 0, "name": "Across the Mystic"},
    {"id": 1, "name": "Across the Charles"},
    {"id": 2, "name": "Across the Neponset"},
]


def load_source_regions():
    data = json.loads(SOURCE.read_text(encoding="utf-8"))
    features = data.get("features", [])
    if len(features) != len(EXPECTED_SOURCE_REGIONS):
        raise RuntimeError(
            f"Expected {len(EXPECTED_SOURCE_REGIONS)} source polygons in {SOURCE.name}, "
            f"found {len(features)}"
        )

    regions = []
    for idx, (feature, expected) in enumerate(zip(features, EXPECTED_SOURCE_REGIONS)):
        geom = shape(feature["geometry"])
        if not isinstance(geom, (Polygon, MultiPolygon)):
            raise RuntimeError(f"Source feature {idx} must be Polygon or MultiPolygon")
        if not geom.is_valid:
            geom = geom.buffer(0)
        geom = geom.simplify(SIMPLIFY_TOLERANCE, preserve_topology=True)
        if not geom.is_valid:
            geom = geom.buffer(0)
        regions.append(
            {
                "id": expected["id"],
                "name": expected["name"],
                "geometry": geom,
            }
        )
    return regions


def load_city_polygons():
    data = json.loads(BOUNDARIES.read_text(encoding="utf-8"))
    cities = {}
    for entry in data.get("cities", []):
        name = entry.get("name")
        geom = entry.get("geometry")
        if not name or not geom:
            continue
        try:
            city_geom = shape(geom)
            if not city_geom.is_valid:
                city_geom = city_geom.buffer(0)
            cities[name] = city_geom
        except Exception as exc:
            print(f"  Warning: could not parse geometry for {name}: {exc}")
    return cities


def load_stops():
    data = json.loads(MBTA_DATA.read_text(encoding="utf-8"))
    seen = {}
    for line in data.get("lines", []):
        for stop in line.get("stops", []):
            seen.setdefault(
                stop["id"],
                {
                    "id": stop["id"],
                    "name": stop["name"],
                    "lat": stop["lat"],
                    "lng": stop["lng"],
                },
            )
    return list(seen.values())


def assign_region_id(stop, explicit_regions):
    pt = Point(stop["lng"], stop["lat"])
    for region in explicit_regions:
        geom = region["geometry"]
        if geom.contains(pt) or geom.touches(pt):
            return region["id"]
    return MAINLAND_ID


def containing_city_name(stop, city_polygons):
    pt = Point(stop["lng"], stop["lat"])
    for name, geom in city_polygons.items():
        if geom.contains(pt) or geom.touches(pt):
            return name
    return None


def polygonal_part(geom):
    if isinstance(geom, (Polygon, MultiPolygon)):
        return geom
    if isinstance(geom, GeometryCollection):
        polys = [part for part in geom.geoms if isinstance(part, (Polygon, MultiPolygon))]
        if not polys:
            return None
        return unary_union(polys)
    return None


def geom_to_json(geom):
    if isinstance(geom, Polygon):
        return mapping(geom)
    if isinstance(geom, MultiPolygon):
        return mapping(geom)
    poly = polygonal_part(geom)
    if poly is None:
        raise RuntimeError("Geometry has no polygonal part")
    if isinstance(poly, Polygon):
        return mapping(poly)
    return mapping(poly)


def build_mainland_geometry(stops, assignments, city_polygons, explicit_regions):
    mainland_stops = [stop for stop in stops if assignments[stop["id"]] == MAINLAND_ID]
    if not mainland_stops:
        raise RuntimeError("No stops assigned to Mainland Boston")

    mainland_city_names = []
    for stop in mainland_stops:
        city_name = containing_city_name(stop, city_polygons)
        if city_name and city_name not in mainland_city_names:
            mainland_city_names.append(city_name)

    city_geoms = [city_polygons[name] for name in mainland_city_names if name in city_polygons]
    if not city_geoms:
        raise RuntimeError("Could not derive mainland geometry from city boundaries")

    mainland_union = unary_union(city_geoms)
    excluded = unary_union([
        region["geometry"] if region["geometry"].is_valid else region["geometry"].buffer(0)
        for region in explicit_regions
    ])
    mainland_geom = mainland_union.difference(excluded)
    mainland_geom = polygonal_part(mainland_geom)
    if mainland_geom is None or mainland_geom.is_empty:
        raise RuntimeError("Derived mainland geometry is empty")

    mainland_geom = mainland_geom.simplify(SIMPLIFY_TOLERANCE, preserve_topology=True)
    return mainland_geom, mainland_city_names


def summarise(stops, assignments, regions):
    by_region = {}
    for stop_id, region_id in assignments.items():
        by_region.setdefault(region_id, []).append(stop_id)
    for region in regions:
        region_stop_names = sorted(
            stop["name"] for stop in stops if stop["id"] in by_region.get(region["id"], [])
        )
        print(f"  Region {region['id']} ({region['name']}): {len(region_stop_names)} stops")
        print(f"    {', '.join(region_stop_names)}")


def main():
    print(f"Loading drawn regions from {SOURCE.name}...")
    explicit_regions = load_source_regions()
    for region in explicit_regions:
        print(f"  Region {region['id']}: {region['name']} ({region['geometry'].geom_type})")

    print("Loading boundaries and MBTA stops...")
    city_polygons = load_city_polygons()
    stops = load_stops()
    print(f"  Loaded {len(city_polygons)} city polygons")
    print(f"  Loaded {len(stops)} unique stops")

    print("Assigning stops to explicit regions or Mainland Boston...")
    assignments = {stop["id"]: assign_region_id(stop, explicit_regions) for stop in stops}

    print("Building Mainland Boston fallback geometry...")
    mainland_geom, mainland_city_names = build_mainland_geometry(
        stops, assignments, city_polygons, explicit_regions
    )
    print(f"  Mainland derived from cities: {', '.join(mainland_city_names)}")

    regions = explicit_regions + [
        {
            "id": MAINLAND_ID,
            "name": MAINLAND_NAME,
            "geometry": mainland_geom,
        }
    ]

    summarise(stops, assignments, regions)

    payload = {
        "generatedAt": datetime.now(UTC).isoformat().replace("+00:00", "Z"),
        "pieces": [
            {
                "id": region["id"],
                "name": region["name"],
                "geometry": geom_to_json(region["geometry"]),
            }
            for region in regions
        ],
        "stops": assignments,
    }

    OUTPUT.write_text(json.dumps(payload, separators=(",", ":")) + "\n", encoding="utf-8")
    size_kb = OUTPUT.stat().st_size / 1024
    print(f"Wrote {OUTPUT} ({size_kb:.1f} KB)")


if __name__ == "__main__":
    main()
