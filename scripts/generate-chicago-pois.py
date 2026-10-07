#!/usr/bin/env python3
"""Build Chicago POIs from a dated Geofabrik extract or the checked-in compact snapshot.
Extraction: pip install osmium==4.3.1; python scripts/generate-chicago-pois.py --pbf PATH
Offline regeneration: python scripts/generate-chicago-pois.py
"""
import argparse
import gzip
import hashlib
import json
import math
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SNAPSHOT = ROOT / 'data/chicago/sources/poi-osm.json.gz'
OUTPUT = ROOT / 'data/chicago/pois.json'
BBOX = [-88.15, 41.45, -87.30, 42.30]  # Same padded reference extent as shoreline/water.
DEFINITIONS = json.loads((ROOT / 'scripts/lib/poi-categories.json').read_text())
RULES = {**DEFINITIONS['default'], **DEFINITIONS['chicago']}
CATEGORIES = list(RULES)


def categories(tags):
    """Apply the same category definitions used by Boston's Overpass generator."""
    import re
    if not any(k in tags for k in ('amenity', 'leisure', 'tourism', 'office', 'diplomatic', 'shop')):
        return []
    if any(tags.get(k) in ('yes', 'true', '1') for k in ('disused', 'abandoned', 'demolished')):
        return []
    def matches(term):
        key, op, *values = term
        value = values[0] if values else None
        actual = tags.get(key, '')
        if op == 'present': return bool(actual)
        if op == '=': return actual == value
        if op == '!=': return actual != value
        if op == '!~': return not re.search(value, actual)
        return bool(re.search(value, actual, re.I if op == '~i' else 0))
    return [category for category, alternatives in RULES.items()
            if any(all(matches(term) for term in terms) for terms in alternatives)]


def inside(lat, lng):
    return math.isfinite(lat) and math.isfinite(lng) and BBOX[0] <= lng <= BBOX[2] and BBOX[1] <= lat <= BBOX[3]


def extract(pbf, source_url):
    import osmium
    records = {}
    with osmium.io.Reader(str(pbf)) as reader:
        source_timestamp = reader.header().get('osmosis_replication_timestamp')

    def add(kind, ident, tags, coords):
        tags = dict(tags)
        if not categories(tags): return
        coords = list(coords)
        if not coords: return
        lat = (min(p[1] for p in coords) + max(p[1] for p in coords)) / 2
        lng = (min(p[0] for p in coords) + max(p[0] for p in coords)) / 2
        if inside(lat, lng):
            records[f'{kind}/{ident}'] = {'osmId': f'{kind}/{ident}', 'tags': tags, 'lat': lat, 'lng': lng}

    # Select only POI relations before resolving geometry. An area callback would
    # assemble every multipolygon in Illinois, most of which are irrelevant.
    relations = {}
    needed_ways = set()
    class RelationSelector(osmium.SimpleHandler):
        def relation(self, o):
            if categories(dict(o.tags)):
                members = [m.ref for m in o.members if m.type == 'w' and m.role in ('', 'outer')]
                if members:
                    relations[o.id] = (dict(o.tags), members)
                    needed_ways.update(members)
    RelationSelector().apply_file(str(pbf))
    way_bounds = {}
    class Handler(osmium.SimpleHandler):
        def node(self, o):
            if o.location.valid() and inside(o.location.lat, o.location.lon):
                add('node', o.id, o.tags, [(o.location.lon, o.location.lat)])
        def way(self, o):
            eligible = categories(dict(o.tags))
            if eligible or o.id in needed_ways:
                if all(n.location.valid() for n in o.nodes):
                    coords = [(n.lon, n.lat) for n in o.nodes]
                    if not coords: return
                    if eligible: add('way', o.id, o.tags, coords)
                    if o.id in needed_ways:
                        way_bounds[o.id] = [(min(p[0] for p in coords), min(p[1] for p in coords)),
                                           (max(p[0] for p in coords), max(p[1] for p in coords))]
    Handler().apply_file(str(pbf), locations=True, idx='flex_mem')
    for ident, (tags, members) in relations.items():
        if all(member in way_bounds for member in members):
            add('relation', ident, tags, [point for member in members for point in way_bounds[member]])
    digest = hashlib.sha256()
    with open(pbf, 'rb') as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b''):
            digest.update(chunk)
    sha = digest.hexdigest()
    return {'source': {'url': source_url, 'sha256': sha, 'dataTimestamp': source_timestamp, 'license': 'ODbL-1.0',
                        'attribution': '© OpenStreetMap contributors', 'referenceBbox': BBOX,
                        'coordinateMethod': 'Nodes: actual location; ways/relations: bounding-box center'},
            'elements': sorted(records.values(), key=lambda item: item['osmId'])}


def build(snapshot):
    output = {key: [] for key in CATEGORIES}
    for item in snapshot['elements']:
        if not inside(item['lat'], item['lng']): continue
        for key in categories(item['tags']):
            value = {k: item[k] for k in ('osmId', 'lat', 'lng')}
            value['name'] = item['tags'].get('name') or item['tags'].get('brand') or key
            output[key].append(value)
    # Suppress duplicate node/area representations of the same named facility, not branches.
    for key, items in output.items():
        clean = []
        for item in sorted(items, key=lambda x: (x['name'].casefold(), x['osmId'])):
            if any(item['name'].casefold() == prev['name'].casefold() and
                   math.hypot((item['lat']-prev['lat'])*111320, (item['lng']-prev['lng'])*82700) < 75
                   for prev in clean): continue
            clean.append(item)
        output[key] = clean
    return output


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--pbf', type=Path)
    parser.add_argument('--source-url', default='https://download.geofabrik.de/north-america/us/illinois-261006.osm.pbf')
    args = parser.parse_args()
    if args.pbf and args.pbf.name != args.source_url.rsplit('/', 1)[-1]:
        parser.error('--source-url filename must match --pbf so provenance cannot silently name a different extract')
    if args.pbf:
        snapshot = extract(args.pbf, args.source_url)
        SNAPSHOT.parent.mkdir(parents=True, exist_ok=True)
        SNAPSHOT.write_bytes(gzip.compress(json.dumps(snapshot, sort_keys=True, separators=(',', ':')).encode(), mtime=0))
    else:
        snapshot = json.loads(gzip.decompress(SNAPSHOT.read_bytes()))
    payload = json.loads(OUTPUT.read_text())
    generated = build(snapshot)
    payload.update(generated)
    payload.setdefault('sources', {})['poi-osm'] = {**snapshot['source'],
        'snapshot': str(SNAPSHOT.relative_to(ROOT)), 'snapshotSha256': hashlib.sha256(SNAPSHOT.read_bytes()).hexdigest(),
        'coverage': 'OSM mapped Illinois facilities within referenceBbox; not an exhaustive official business directory'}
    payload['available'] = sorted((set(payload.get('available', [])) - set(generated)) | {k for k, v in generated.items() if v})
    payload['unavailable'] = sorted((set(payload.get('unavailable', [])) - set(generated)) | {k for k, v in generated.items() if not v})
    OUTPUT.write_text(json.dumps(payload, separators=(',', ':')) + '\n')
    print(json.dumps({k: len(v) for k, v in generated.items()}, indent=2))

if __name__ == '__main__': main()
