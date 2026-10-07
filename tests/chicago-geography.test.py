"""Offline geography integrity and regression checks. Requires Shapely 2.x."""
import gzip
import hashlib
import json
import os
import unittest
from pathlib import Path
from shapely.geometry import Point, box, shape
from shapely.ops import unary_union

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / 'data/chicago'

def load(name):
    return json.loads((DATA / name).read_text())

class ChicagoGeography(unittest.TestCase):
    def test_source_hashes(self):
        for name, record in load('sources/manifest.json').items():
            raw = gzip.decompress((DATA / 'sources' / (name + '.json.gz')).read_bytes())
            self.assertEqual(hashlib.sha256(raw).hexdigest(), record['sha256'], name)
            self.assertNotIn('error', json.loads(raw), name)
            self.assertFalse(json.loads(raw).get('exceededTransferLimit'), name)

    def test_boundary_geometry_and_definitions(self):
        data = load('boundaries.json')
        self.assertEqual(len(data['wards']), 50)
        self.assertEqual(len(data['communityAreas']), 77)
        for key in ['municipalities', 'wards', 'communityAreas', 'postcodes']:
            self.assertEqual(len(data[key]), len({r['name'] for r in data[key]}), key)
            for r in data[key]:
                polygon = shape(r['geometry'])
                self.assertTrue(polygon.is_valid and not polygon.is_empty, r['name'])
        for coords, category, expected in [
            ((-87.6298, 41.8781), 'municipalities', 'Chicago'),
            ((-87.6839, 42.0451), 'municipalities', 'Evanston'),
            ((-87.6298, 41.8781), 'communityAreas', 'LOOP'),
            ((-87.697, 42.0732), 'municipalities', 'Wilmette')
        ]:
            names = [r['name'] for r in data[category] if shape(r['geometry']).covers(Point(coords))]
            self.assertIn(expected, names)
        self.assertIn('ZCTA', data['postcodeDefinition'])

    def test_regions_partition_and_control_points(self):
        regions = {r['name']: shape(r['geometry']) for r in load('landmasses.json')['pieces']}
        self.assertEqual(set(regions), {'North','West','Loop + South'})
        envelope = box(-88, 41.60, -87.48, 42.12)
        self.assertLess(unary_union(list(regions.values())).symmetric_difference(envelope).area, 1e-10)
        for a, ga in regions.items():
            self.assertTrue(ga.is_valid)
            for b, gb in regions.items():
                if a != b:
                    self.assertLess(ga.intersection(gb).area, 1e-10)
        for name, coords in [
            ('North', (-87.65,41.95)), ('North',(-87.6839,42.0451)),
            ('West',(-87.75,41.88)), ('West',(-87.9048,41.9777)),
            ('Loop + South',(-87.625,41.88)), ('Loop + South',(-87.63,41.75)),
            ('West',(-87.646,41.882)), ('North',(-87.63,41.892))
        ]:
            self.assertTrue(regions[name].covers(Point(coords)), (name, coords))

    def test_actual_shore_and_bank_lines(self):
        data = load('pois.json')
        west, south, east, north = data['reference_bbox']
        for key in ['coastlineLines','bodiesOfWaterLines']:
            self.assertTrue(data[key])
            for f in data[key]:
                g = shape(f['geometry'])
                self.assertTrue(g.is_valid and not g.is_empty)
                for line in ([g] if g.geom_type == 'LineString' else g.geoms):
                    cs = list(line.coords)
                    for a,b in zip(cs,cs[1:]):
                        self.assertFalse(any(abs(a[axis]-edge)<1e-9 and abs(b[axis]-edge)<1e-9
                                             for axis,edge in [(0,west),(0,east),(1,south),(1,north)]), (key,a,b))
        coast = unary_union([shape(f['geometry']) for f in data['coastlineLines']])
        self.assertLess(coast.distance(Point(-87.613,41.89)),0.02)
        self.assertGreater(coast.distance(Point(-87.85,41.9)),0.1)
        water = unary_union([shape(f['geometry']) for f in data['bodiesOfWaterLines']])
        self.assertLess(water.distance(Point(-87.638,41.8866)),0.002)
        # Independent generators populate these datasets without disturbing water edges.
        self.assertTrue(data['amtrakLines'])
        self.assertNotIn('amtrakLines', data.get('unavailable', {}))
        self.assertTrue(load('elevation-grid.json')['available'])

    def test_every_cta_station_has_region_municipality_and_zip(self):
        path = Path(os.environ.get('JETLAG_TRANSIT_PATH', DATA / 'transit.json'))
        if not path.exists():
            self.skipTest('Run after merging Chicago transit, or set JETLAG_TRANSIT_PATH')
        stations = {s['id']:s for line in json.loads(path.read_text())['lines'] for s in line['stops']}
        self.assertGreaterEqual(len(stations),140)
        data = load('boundaries.json')
        data['regions'] = load('landmasses.json')['pieces']
        for category in ['municipalities','postcodes','regions']:
            polygons = [shape(r['geometry']) for r in data[category]]
            for s in stations.values():
                self.assertTrue(any(p.covers(Point(s['lng'],s['lat'])) for p in polygons), (category,s['name']))

if __name__ == '__main__':
    unittest.main()
