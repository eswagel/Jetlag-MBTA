#!/usr/bin/env python3

import json
from datetime import UTC, datetime
from pathlib import Path
from urllib.parse import quote_plus
from urllib.request import Request, urlopen

from shapely.geometry import GeometryCollection, LineString, MultiPolygon, Point, Polygon, box, mapping, shape
from shapely.ops import polygonize, unary_union


ROOT = Path(__file__).resolve().parent.parent
OUTPUT = ROOT / "data" / "landmasses.json"
CACHE_DIR = ROOT / "data" / "_cache" / "landmasses-v1"
MBTA_DATA = ROOT / "data" / "mbta-data.json"
BBOX = {"south": 42.18, "west": -71.55, "north": 42.67, "east": -70.85}
OVERPASS_ENDPOINTS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
]
RIVER_BUFFER_DEGREES = 0.00035
SIMPLIFY_TOLERANCE = 0.0004


def read_json_if_exists(path: Path):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return None


def write_json(path: Path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2) + "\n", encoding="utf-8")


def overpass_raw(query: str):
    payload = ("data=" + quote_plus(query)).encode("utf-8")
    for url in OVERPASS_ENDPOINTS:
        try:
            req = Request(
                url,
                data=payload,
                headers={
                    "Content-Type": "application/x-www-form-urlencoded",
                    "User-Agent": "Jetlag-MBTA-Landmass-Generator/1.0",
                },
                method="POST",
            )
            with urlopen(req, timeout=120) as res:
                text = res.read().decode("utf-8")
            return json.loads(text)
        except Exception:
            continue
    raise RuntimeError("All Overpass endpoints failed")


def load_stops():
    data = json.loads(MBTA_DATA.read_text(encoding="utf-8"))
    deduped = {}
    for line in data.get("lines", []):
        for stop in line.get("stops", []):
            deduped.setdefault(
                stop["id"],
                {"id": stop["id"], "name": stop["name"], "lat": stop["lat"], "lng": stop["lng"]},
            )
    return list(deduped.values())


def fetch_coastline_ways():
    query = f"""[out:json][timeout:120];
    way["natural"="coastline"]({BBOX["south"]},{BBOX["west"]},{BBOX["north"]},{BBOX["east"]});
    out geom;"""
    data = overpass_raw(query)
    return [
        el
        for el in data.get("elements", [])
        if el.get("type") == "way" and isinstance(el.get("geometry"), list) and len(el["geometry"]) >= 2
    ]


def fetch_water_elements():
    query = f"""[out:json][timeout:120];
    (
      way["natural"~"^(water|bay)$"]({BBOX["south"]},{BBOX["west"]},{BBOX["north"]},{BBOX["east"]});
      relation["natural"~"^(water|bay)$"]({BBOX["south"]},{BBOX["west"]},{BBOX["north"]},{BBOX["east"]});
      way["waterway"="river"]({BBOX["south"]},{BBOX["west"]},{BBOX["north"]},{BBOX["east"]});
      way["waterway"="riverbank"]({BBOX["south"]},{BBOX["west"]},{BBOX["north"]},{BBOX["east"]});
      relation["waterway"="riverbank"]({BBOX["south"]},{BBOX["west"]},{BBOX["north"]},{BBOX["east"]});
    );
    out geom;"""
    data = overpass_raw(query)
    return data.get("elements", [])


def coord_key(coord):
    return f"{coord[0]:.6f},{coord[1]:.6f}"


def same_coord(a, b):
    return coord_key(a) == coord_key(b)


def close_ring(ring):
    if not ring:
        return ring
    return ring if same_coord(ring[0], ring[-1]) else ring + [ring[0]]


def ring_area(ring):
    total = 0.0
    for i in range(len(ring) - 1):
        x1, y1 = ring[i]
        x2, y2 = ring[i + 1]
        total += (x1 * y2) - (x2 * y1)
    return total / 2.0


def point_in_ring(point, ring):
    px, py = point
    inside = False
    j = len(ring) - 1
    for i in range(len(ring)):
        xi, yi = ring[i]
        xj, yj = ring[j]
        intersects = ((yi > py) != (yj > py)) and (
            px < (xj - xi) * (py - yi) / ((yj - yi) or 1e-12) + xi
        )
        if intersects:
            inside = not inside
        j = i
    return inside


def dedupe_segment(segment):
    out = []
    for coord in segment:
        if not out or not same_coord(coord, out[-1]):
            out.append(coord)
    return out


def stitch_segments(segments):
    pool = [dedupe_segment(segment) for segment in segments if len(segment) >= 2]
    rings = []

    while pool:
        current = pool.pop(0)
        changed = True
        while changed:
            changed = False
            for i, candidate in enumerate(pool):
                start = current[0]
                end = current[-1]
                cand_start = candidate[0]
                cand_end = candidate[-1]

                if same_coord(end, cand_start):
                    current = current + candidate[1:]
                elif same_coord(end, cand_end):
                    current = current + list(reversed(candidate[:-1]))
                elif same_coord(start, cand_end):
                    current = candidate[:-1] + current
                elif same_coord(start, cand_start):
                    current = list(reversed(candidate[1:])) + current
                else:
                    continue

                pool.pop(i)
                changed = True
                break

        current = close_ring(current)
        if len(current) >= 4 and same_coord(current[0], current[-1]):
            rings.append(current)

    return rings


def relation_to_geometry(relation):
    outer_segments = []
    inner_segments = []
    for member in relation.get("members", []):
        if member.get("type") != "way" or not isinstance(member.get("geometry"), list) or len(member["geometry"]) < 2:
            continue
        segment = [(point["lon"], point["lat"]) for point in member["geometry"]]
        if member.get("role") == "inner":
            inner_segments.append(segment)
        else:
            outer_segments.append(segment)

    outer_rings = sorted(stitch_segments(outer_segments), key=lambda ring: abs(ring_area(ring)), reverse=True)
    inner_rings = stitch_segments(inner_segments)
    if not outer_rings:
        return None

    polygons = [{"outer": ring, "holes": []} for ring in outer_rings]
    for hole in inner_rings:
        container = next((poly for poly in polygons if point_in_ring(hole[0], poly["outer"])), None)
        if container is not None:
            container["holes"].append(hole)

    shapes = []
    for poly in polygons:
        try:
            geom = Polygon(poly["outer"], poly["holes"])
            if not geom.is_empty:
                shapes.append(geom)
        except Exception:
            continue

    if not shapes:
        return None
    if len(shapes) == 1:
        return shapes[0]
    return MultiPolygon(shapes)


def flatten_polygons(geom):
    if geom is None or geom.is_empty:
        return []
    if isinstance(geom, Polygon):
        return [geom]
    if isinstance(geom, MultiPolygon):
        return [poly for poly in geom.geoms if not poly.is_empty]
    if isinstance(geom, GeometryCollection):
        out = []
        for part in geom.geoms:
            out.extend(flatten_polygons(part))
        return out
    return []


def build_land_faces_from_coastline_ways(ways, stops):
    lines = []
    for way in ways:
        coords = [(p["lon"], p["lat"]) for p in way.get("geometry", [])]
        if len(coords) >= 2:
            lines.append(LineString(coords))

    lines.append(box(BBOX["west"], BBOX["south"], BBOX["east"], BBOX["north"]).boundary)
    merged = unary_union(lines)
    stop_points = [Point(stop["lng"], stop["lat"]) for stop in stops]

    faces = []
    for face in polygonize(merged):
        if any(face.contains(pt) or face.touches(pt) for pt in stop_points):
            faces.append(face)
    return faces


def build_water_geometries(elements):
    out = []
    for el in elements:
        geom = el.get("geometry")
        if el.get("type") == "way" and isinstance(geom, list) and len(geom) >= 2:
            coords = [(p["lon"], p["lat"]) for p in geom]
            is_closed = same_coord(coords[0], coords[-1])
            if el.get("tags", {}).get("waterway") == "river" and not is_closed:
                try:
                    out.extend(flatten_polygons(LineString(coords).buffer(RIVER_BUFFER_DEGREES, cap_style=2, join_style=2)))
                except Exception:
                    pass
                continue
            if is_closed or len(coords) >= 4:
                try:
                    out.extend(flatten_polygons(Polygon(close_ring(coords))))
                except Exception:
                    pass
            continue

        if el.get("type") == "relation":
            geom = relation_to_geometry(el)
            if geom is not None:
                out.extend(flatten_polygons(geom))
    return out


def simplify_geom(geom):
    try:
        return geom.simplify(SIMPLIFY_TOLERANCE, preserve_topology=True)
    except Exception:
        return geom


def assign_stops_to_pieces(stops, pieces):
    stop_index = {}
    piece_stops = [[] for _ in pieces]
    for stop in stops:
        pt = Point(stop["lng"], stop["lat"])
        for idx, piece in enumerate(pieces):
            if piece.contains(pt) or piece.touches(pt):
                stop_index[stop["id"]] = idx
                piece_stops[idx].append(stop["name"])
                break
    return stop_index, piece_stops


def name_piece(stop_names, index):
    names = set(stop_names)
    if {"Braintree", "Quincy Center", "North Quincy"} & names:
        return "Quincy / Braintree"
    if {"Airport", "Maverick", "Wonderland", "Revere Beach"} & names:
        if {"Alewife", "Harvard", "Assembly", "Sullivan Square"} & names:
            return "North Side / East Boston"
        return "East Boston"
    if {"Park Street", "Downtown Crossing", "Copley", "Kenmore"} & names:
        return "Boston / Brookline"
    return f"Landmass {index + 1}"


def main():
    print("Loading MBTA stops...")
    stops = load_stops()
    print(f"Loaded {len(stops)} unique stops")

    coastline_cache = CACHE_DIR / "coastline-ways.json"
    coastline_ways = read_json_if_exists(coastline_cache)
    if coastline_ways is None:
        print("Fetching coastline ways...")
        coastline_ways = fetch_coastline_ways()
        print(f"Fetched {len(coastline_ways)} coastline ways")
        write_json(coastline_cache, coastline_ways)
    else:
        print(f"Loaded {len(coastline_ways)} cached coastline ways")

    land_faces_cache = CACHE_DIR / "land-faces-py.json"
    land_faces_json = read_json_if_exists(land_faces_cache)
    if land_faces_json is None:
        print("Building coastal land faces...")
        land_faces = build_land_faces_from_coastline_ways(coastline_ways, stops)
        print(f"Kept {len(land_faces)} coastline-derived land faces")
        write_json(
            land_faces_cache,
            [{"type": "Feature", "properties": {}, "geometry": mapping(face)} for face in land_faces],
        )
    else:
        land_faces = [shape(feature["geometry"]) for feature in land_faces_json]
        print(f"Loaded {len(land_faces)} cached coastline-derived land faces")

    if not land_faces:
        raise RuntimeError("No coastline-derived land faces contained MBTA stops")

    water_cache = CACHE_DIR / "water-elements.json"
    water_elements = read_json_if_exists(water_cache)
    if water_elements is None:
        print("Fetching water polygons...")
        water_elements = fetch_water_elements()
        print(f"Fetched {len(water_elements)} water elements")
        write_json(water_cache, water_elements)
    else:
        print(f"Loaded {len(water_elements)} cached water elements")

    print("Building water geometries...")
    water_geoms = build_water_geometries(water_elements)
    print(f"Built {len(water_geoms)} water polygons")

    raw_piece_cache = CACHE_DIR / "raw-pieces-py.json"
    raw_piece_json = read_json_if_exists(raw_piece_cache)
    if raw_piece_json is None:
        print("Subtracting water from land faces...")
        water_union = unary_union(water_geoms) if water_geoms else GeometryCollection()
        land_union = unary_union(land_faces)
        raw_geom = land_union.difference(water_union) if not water_union.is_empty else land_union
        raw_pieces = [simplify_geom(piece) for piece in flatten_polygons(raw_geom) if not piece.is_empty]
        print(f"Built {len(raw_pieces)} raw land pieces")
        write_json(
            raw_piece_cache,
            [{"type": "Feature", "properties": {}, "geometry": mapping(piece)} for piece in raw_pieces],
        )
    else:
        raw_pieces = [shape(feature["geometry"]) for feature in raw_piece_json]
        print(f"Loaded {len(raw_pieces)} cached raw land pieces")

    stop_index, piece_stops = assign_stops_to_pieces(stops, raw_pieces)
    used_piece_ids = sorted(set(stop_index.values()))
    pieces = []
    remapped_stops = {}
    for new_idx, old_idx in enumerate(used_piece_ids):
        names = piece_stops[old_idx]
        label = name_piece(names, new_idx)
        pieces.append({"id": new_idx, "name": label, "geometry": mapping(raw_pieces[old_idx])})
        for stop_id, piece_idx in stop_index.items():
            if piece_idx == old_idx:
                remapped_stops[stop_id] = new_idx

    payload = {
        "generatedAt": datetime.now(UTC).isoformat().replace("+00:00", "Z"),
        "pieces": pieces,
        "stops": remapped_stops,
    }

    write_json(OUTPUT, payload)
    print(f"Wrote {OUTPUT}")


if __name__ == "__main__":
    main()
