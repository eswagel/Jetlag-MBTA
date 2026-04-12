#!/usr/bin/env python3
"""
Generate runtime landmass data from hand-drawn gameplay regions.

Input:
- data/landmass-regions.geojson (hand-drawn priors)
- data/boundaries.json (municipal polygons with coastline/river-aware boundaries)
- data/mbta-data.json (stop locations)

Output:
- data/landmasses.json
  Cached runtime payload with polygons + stop -> region assignment.
"""

import json
from datetime import datetime, timezone
from pathlib import Path

from shapely.geometry import GeometryCollection, MultiPolygon, Point, Polygon, mapping, shape
from shapely.ops import unary_union

ROOT = Path(__file__).resolve().parent.parent
BOUNDARIES = ROOT / "data" / "boundaries.json"
MBTA_DATA = ROOT / "data" / "mbta-data.json"
SOURCE = ROOT / "data" / "landmass-regions.geojson"
OUTPUT = ROOT / "data" / "landmasses.json"

SIMPLIFY_TOLERANCE = 0.0003
PRIOR_BUFFER_DEG = 0.0025
OVERLAP_WEIGHT = 1.0
STOP_WEIGHT = 0.35
MAINLAND_ID = 3
MAINLAND_NAME = "Mainland Boston"
EXPECTED_SOURCE_REGIONS = [
    {"id": 0, "name": "Across the Mystic"},
    {"id": 1, "name": "Across the Charles"},
    {"id": 2, "name": "Across the Neponset"},
]


def polygonal_part(geom):
    if isinstance(geom, (Polygon, MultiPolygon)):
        return geom
    if isinstance(geom, GeometryCollection):
        polys = [part for part in geom.geoms if isinstance(part, (Polygon, MultiPolygon))]
        if not polys:
            return None
        return unary_union(polys)
    return None


def clean_polygonal(geom):
    if geom is None:
        return None
    poly = polygonal_part(geom)
    if poly is None or poly.is_empty:
        return None
    if not poly.is_valid:
        poly = poly.buffer(0)
    poly = polygonal_part(poly)
    if poly is None or poly.is_empty:
        return None
    return poly.simplify(SIMPLIFY_TOLERANCE, preserve_topology=True)


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
        geom = clean_polygonal(shape(feature["geometry"]))
        if geom is None:
            raise RuntimeError(f"Source feature {idx} has no polygonal geometry")
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
            city_geom = clean_polygonal(shape(geom))
            if city_geom is None:
                continue
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


def containing_city_name(stop, city_polygons):
    pt = Point(stop["lng"], stop["lat"])
    for name, geom in city_polygons.items():
        if geom.contains(pt) or geom.touches(pt):
            return name
    return None


def assign_prior_region_id(stop, prior_regions):
    pt = Point(stop["lng"], stop["lat"])
    for region in prior_regions:
        if region["geometry"].contains(pt) or region["geometry"].touches(pt):
            return region["id"]
    return MAINLAND_ID


def iter_polygons(geom):
    if isinstance(geom, Polygon):
        return [geom]
    if isinstance(geom, MultiPolygon):
        return list(geom.geoms)
    return []


def build_playable_land(stops, city_polygons):
    city_names = []
    for stop in stops:
        city_name = containing_city_name(stop, city_polygons)
        if city_name and city_name not in city_names:
            city_names.append(city_name)

    city_geoms = [city_polygons[name] for name in city_names if name in city_polygons]
    if not city_geoms:
        raise RuntimeError("Could not derive playable land geometry from city boundaries")

    playable_land = clean_polygonal(unary_union(city_geoms))
    if playable_land is None:
        raise RuntimeError("Playable land union is empty")
    return playable_land, city_names


def refine_regions_from_land(prior_regions, playable_land, stops, prior_assignments):
    buffered_priors = {
        region["id"]: clean_polygonal(region["geometry"].buffer(PRIOR_BUFFER_DEG))
        for region in prior_regions
    }
    components = [clean_polygonal(poly) for poly in iter_polygons(playable_land)]
    components = [poly for poly in components if poly is not None and not poly.is_empty]

    assignments = {region["id"]: [] for region in prior_regions}
    assignments[MAINLAND_ID] = []

    for comp in components:
        comp_area = comp.area if comp.area > 0 else 1e-12
        comp_stop_ids = [
            stop["id"]
            for stop in stops
            if comp.contains(Point(stop["lng"], stop["lat"])) or comp.touches(Point(stop["lng"], stop["lat"]))
        ]

        best_region = MAINLAND_ID
        best_score = 0.0
        for region in prior_regions:
            rid = region["id"]
            buffered = buffered_priors.get(rid)
            if buffered is None:
                continue
            overlap = clean_polygonal(comp.intersection(buffered))
            overlap_ratio = (overlap.area / comp_area) if overlap is not None else 0.0

            stop_hits = sum(1 for sid in comp_stop_ids if prior_assignments.get(sid) == rid)
            stop_ratio = (stop_hits / len(comp_stop_ids)) if comp_stop_ids else 0.0
            score = (OVERLAP_WEIGHT * overlap_ratio) + (STOP_WEIGHT * stop_ratio)

            if score > best_score:
                best_score = score
                best_region = rid

        assignments[best_region].append(comp)

    refined = []
    for region in prior_regions:
        rid = region["id"]
        region_geom = clean_polygonal(unary_union(assignments.get(rid) or []))
        if region_geom is None:
            region_geom = clean_polygonal(playable_land.intersection(region["geometry"]))
        if region_geom is None:
            continue
        refined.append({"id": rid, "name": region["name"], "geometry": region_geom})

    used_union = clean_polygonal(unary_union([r["geometry"] for r in refined]))
    mainland_geom = clean_polygonal(playable_land.difference(used_union)) if used_union else playable_land
    if mainland_geom is None:
        mainland_geom = playable_land

    return refined, mainland_geom


def assign_stops_to_regions(stops, explicit_regions):
    assignments = {}
    for stop in stops:
        pt = Point(stop["lng"], stop["lat"])
        region_id = MAINLAND_ID
        for region in explicit_regions:
            geom = region["geometry"]
            if geom.contains(pt) or geom.touches(pt):
                region_id = region["id"]
                break
        assignments[stop["id"]] = region_id
    return assignments


def geom_to_json(geom):
    geom = clean_polygonal(geom)
    if geom is None:
        raise RuntimeError("Geometry has no polygonal part")
    return mapping(geom)


def summarise(stops, assignments, regions):
    by_region = {}
    for stop_id, region_id in assignments.items():
        by_region.setdefault(region_id, []).append(stop_id)
    for region in regions:
        region_stop_names = sorted(
            stop["name"] for stop in stops if stop["id"] in by_region.get(region["id"], [])
        )
        print(f"  Region {region['id']} ({region['name']}): {len(region_stop_names)} stops")
        if region_stop_names:
            print(f"    {', '.join(region_stop_names)}")


def main():
    print(f"Loading drawn region priors from {SOURCE.name}...")
    prior_regions = load_source_regions()

    print("Loading boundaries and MBTA stops...")
    city_polygons = load_city_polygons()
    stops = load_stops()
    print(f"  Loaded {len(city_polygons)} city polygons")
    print(f"  Loaded {len(stops)} unique stops")

    print("Computing prior stop assignments (guidance only)...")
    prior_assignments = {stop["id"]: assign_prior_region_id(stop, prior_regions) for stop in stops}

    print("Building coastline/river-aware playable land from municipal polygons...")
    playable_land, city_names = build_playable_land(stops, city_polygons)
    print(f"  Playable land derived from cities: {', '.join(city_names)}")

    print("Refining hand-drawn priors onto automatic land components...")
    refined_explicit_regions, mainland_geom = refine_regions_from_land(
        prior_regions, playable_land, stops, prior_assignments
    )

    regions = refined_explicit_regions + [
        {
            "id": MAINLAND_ID,
            "name": MAINLAND_NAME,
            "geometry": mainland_geom,
        }
    ]

    print("Assigning stops against refined geometries...")
    assignments = assign_stops_to_regions(stops, refined_explicit_regions)
    summarise(stops, assignments, regions)

    payload = {
        "generatedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
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
