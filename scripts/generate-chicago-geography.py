#!/usr/bin/env python3
"""Build Chicago geography from pinned public-source snapshots (offline by default).

Requires Python 3.10+ and Shapely 2.x. See docs/chicago-geography.md.
"""
import argparse
import gzip
import hashlib
import json
from pathlib import Path
from shapely.geometry import shape, mapping, box, Point, LineString
from shapely.ops import unary_union, polygonize

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / 'data/chicago'
SOURCES = DATA / 'sources'
BBOX = [-88.00, 41.60, -87.48, 42.12]
REFERENCE_BBOX = [-88.15, 41.45, -87.30, 42.30]
VERSION = 'chicago-geography-v1'

def read_source(name):
    raw = gzip.decompress((SOURCES / (name + '.json.gz')).read_bytes())
    manifest = json.loads((SOURCES / 'manifest.json').read_text())
    if hashlib.sha256(raw).hexdigest() != manifest[name]['sha256']:
        raise ValueError(f'Source hash mismatch: {name}')
    data = json.loads(raw)
    if 'features' not in data or data.get('exceededTransferLimit'):
        raise ValueError(f'Incomplete or invalid source: {name}')
    return data

def write_json(name, data):
    (DATA / name).write_text(json.dumps(data, separators=(',', ':'), ensure_ascii=False) + '\n')

def metadata():
    manifest = json.loads((SOURCES / 'manifest.json').read_text())
    return {'city_id': 'chicago', 'dataset_version': 'chicago-v1', 'geographyVersion': VERSION, 'bbox': dict(zip(['west','south','east','north'], BBOX)),
            'sources': manifest}

def normalize_boundaries(source, field, prefix=''):
    results = []
    for f in read_source(source)['features']:
        geometry = shape(f['geometry'])
        if not geometry.is_valid:
            # Repair only polygon ring self-intersections, retaining source geometry otherwise.
            from shapely import make_valid
            geometry = make_valid(geometry)
        if geometry.geom_type not in ('Polygon', 'MultiPolygon') or geometry.is_empty:
            raise ValueError(f'Invalid polygon {source} {f["properties"]}')
        name = prefix + str(f['properties'][field])
        results.append({'name': name, 'geometry': mapping(geometry)})
    return sorted(results, key=lambda x: x['name'])

def build_boundaries():
    boundaries = metadata()
    boundaries.update({
        'municipalities': normalize_boundaries('municipalities', 'BASENAME'),
        'wards': normalize_boundaries('wards', 'ward', 'Ward '),
        'communityAreas': normalize_boundaries('community', 'community'),
        'postcodes': normalize_boundaries('postcodes', 'BASENAME'),
        'postcodeDefinition': '2020 Census ZIP Code Tabulation Areas (ZCTAs), not USPS delivery boundaries',
    })
    assert len(boundaries['wards']) == 50
    assert len(boundaries['communityAreas']) == 77
    write_json('boundaries.json', boundaries)

def polygon_features(source, accepted_types):
    from shapely import make_valid
    for feature in read_source(source)['features']:
        if feature['properties'].get('FTYPE') not in accepted_types:
            continue
        geometry = shape(feature['geometry'])
        if not geometry.is_valid:
            geometry = make_valid(geometry)
        if geometry.is_empty:
            continue
        yield feature, geometry


def linear_feature(name, geometry):
    # Simplify actual linework, never a clipped polygon's artificial bbox edge.
    return {'type': 'Feature', 'properties': {'name': name}, 'geometry': mapping(geometry)}


def build_water():
    clip = box(*REFERENCE_BBOX)
    waters = list(polygon_features('nhd-water', {390, 436}))
    rivers = list(polygon_features('nhd-areas', {460}))
    lake = unary_union([g for f, g in waters if f['properties'].get('GNIS_NAME') == 'Lake Michigan'])
    if lake.is_empty:
        raise ValueError('Lake Michigan source missing')
    shoreline = lake.boundary.simplify(0.00001, preserve_topology=True).intersection(clip)
    # Merge contiguous water polygons BEFORE taking boundaries: internal reach joins
    # are not water edges. A wider clip keeps its artificial edges out of the result.
    wide_clip = clip.buffer(0.02)
    water = unary_union([g.intersection(wide_clip) for _, g in waters + rivers])
    edges = water.boundary.simplify(0.00001, preserve_topology=True).intersection(clip)
    pois = metadata()
    pois.update({
        'reference_bbox': REFERENCE_BBOX,
        'coastlineLines': [linear_feature('Lake Michigan shoreline', shoreline)],
        'bodiesOfWaterLines': [linear_feature('Mapped water edges', edges)],
        'bodiesOfWaterDefinition': 'USGS NHD lake/pond and reservoir polygons plus mapped stream/river areas; nearest bank or shore, excluding wetlands, treatment areas and unmapped narrow streams',
        'available': ['coastlineLines', 'bodiesOfWaterLines'],
        'unavailable': ['amtrakLines','parks','golfCourses','libraries','hospitals','medicalSites','museums','movieTheaters','zooAquariums','foreignConsulates','amusementParks','dunkin','starbucks','cvs','mcdonalds','gasStations'],
    })
    for key in pois['unavailable']:
        pois[key] = []
    write_json('pois.json', pois)
    write_json('elevation-grid.json', {**metadata(), 'available': False,
        'unavailable': ['elevation'], 'reason': 'Chicago elevation grid has not been acquired or validated.'})


def build_landmasses():
    import heapq
    from collections import defaultdict
    from math import inf
    clip = box(*BBOX)
    graph = defaultdict(list)
    for f in read_source('nhd-flowlines')['features']:
        geometry = shape(f['geometry']).intersection(clip)
        lines = [geometry] if geometry.geom_type == 'LineString' else getattr(geometry, 'geoms', [])
        for line in lines:
            if line.geom_type != 'LineString' or line.is_empty:
                continue
            coords = list(line.coords)
            # NHD endpoint discrepancies below 1cm are numerical, not new waterways.
            a, z = [tuple(round(x, 7) for x in c) for c in (coords[0], coords[-1])]
            coords[0], coords[-1] = a, z
            ident = f['properties']['permanent_identifier']
            graph[a].append((z, line.length, coords, ident))
            graph[z].append((a, line.length, list(reversed(coords)), ident))
    root = (-87.6380703, 41.8865553)  # Wolf Point, NHD common river junction
    endpoints = [(-87.7870603, 42.12), (-88.0, 41.6791068), (-87.6140897, 41.8884031)]
    paths, identifiers = [], set()
    for end in endpoints:
        queue, distance, previous = [(0, root)], {root: 0}, {}
        while queue:
            dist, node = heapq.heappop(queue)
            if node == end:
                break
            if dist > distance[node]:
                continue
            for nxt, length, coords, ident in graph[node]:
                candidate = dist + length
                if candidate < distance.get(nxt, inf):
                    distance[nxt], previous[nxt] = candidate, (node, coords, ident)
                    heapq.heappush(queue, (candidate, nxt))
        if end not in previous:
            raise ValueError(f'River endpoint disconnected: {end}; review source before release')
        coords, cursor = [end], end
        while cursor != root:
            cursor, segment, ident = previous[cursor]
            coords = segment[:-1] + coords
            identifiers.add(ident)
        paths.append(coords)
    # NHD main-river centerline ends at the lakefront navigation channel.
    # Continue through Lake Michigan only to close the gameplay envelope.
    paths[-1].append((BBOX[2], paths[-1][-1][1]))
    polygons = list(polygonize(unary_union([clip.boundary] + [LineString(p) for p in paths])))
    if len(polygons) != 3:
        raise ValueError(f'Expected 3 regions, got {len(polygons)}')
    pieces = []
    for ident, (name, location) in enumerate([
        ('North', (-87.65, 41.95)), ('West', (-87.75, 41.88)), ('Loop + South', (-87.625, 41.88))
    ]):
        matches = [p for p in polygons if p.contains(Point(location))]
        if len(matches) != 1:
            raise ValueError(f'Ambiguous region control: {name}')
        pieces.append({'id': ident, 'name': name, 'geometry': mapping(matches[0])})
    write_json('landmasses.json', {**metadata(), 'pieces': pieces,
        'definition': 'North Branch Chicago River; Chicago River; South Branch continuing along Sanitary and Ship Canal. NHD centerlines partition land, bridges and river islands by bank-side gameplay convention.',
        'river_reach_ids': sorted(identifiers),
        'lake_extension': [paths[-1][-2], paths[-1][-1]]})


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.parse_args()
    build_boundaries()
    build_water()
    build_landmasses()
