import gzip
import hashlib
import importlib.util
import json
from pathlib import Path
import unittest
import tempfile

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('pois', ROOT/'scripts/generate-chicago-pois.py')
pois = importlib.util.module_from_spec(spec)
spec.loader.exec_module(pois)

class ChicagoPoisTests(unittest.TestCase):
    def test_hospitals_do_not_include_clinics(self):
        self.assertIn('hospitals', pois.categories({'amenity':'hospital'}))
        self.assertNotIn('hospitals', pois.categories({'amenity':'clinic', 'name':'Hospital clinic'}))
        self.assertNotIn('hospitals', pois.categories({'amenity':'hospital', 'healthcare':'clinic'}))
        self.assertNotIn('hospitals', pois.categories({'amenity':'hospital', 'healthcare':'psychotherapist'}))
        self.assertNotIn('medicalSites', pois.categories({'amenity':'clinic'}))

    def test_amusement_parks_do_not_include_arcades(self):
        self.assertIn('amusementParks', pois.categories({'tourism':'theme_park'}))
        self.assertNotIn('amusementParks', pois.categories({'leisure':'amusement_arcade'}))
        self.assertNotIn('amusementParks', pois.categories({'tourism':'theme_park', 'leisure':'amusement_arcade'}))

    def test_chain_names_need_operating_business_tags(self):
        self.assertNotIn('starbucks', pois.categories({'name':'Starbucks', 'building':'yes'}))
        self.assertIn('cvs', pois.categories({'amenity':'pharmacy', 'brand':'CVS Pharmacy'}))
        self.assertNotIn('foreignConsulates', pois.categories({'office':'diplomatic', 'diplomatic':'embassy'}))

    def test_snapshot_rebuild_and_extent(self):
        snapshot = json.loads(gzip.decompress(pois.SNAPSHOT.read_bytes()))
        actual = json.loads(pois.OUTPUT.read_text())
        self.assertEqual(actual['sources']['poi-osm']['snapshotSha256'], hashlib.sha256(pois.SNAPSHOT.read_bytes()).hexdigest())
        self.assertEqual(actual['sources']['poi-osm']['dataTimestamp'], snapshot['source']['dataTimestamp'])
        rebuilt = pois.build(snapshot)
        self.assertEqual({k:actual[k] for k in pois.CATEGORIES}, rebuilt)
        for category, records in rebuilt.items():
            self.assertGreater(len(records), 0, category)
            self.assertIn(category, actual['available'])
            self.assertNotIn(category, actual['unavailable'])
            self.assertTrue(all(pois.inside(item['lat'], item['lng']) for item in records))
        self.assertTrue(any('Lincoln Park Zoo' in item['name'] for item in rebuilt['zooAquariums']))
        self.assertTrue(any('Shedd' in item['name'] for item in rebuilt['zooAquariums']))
        self.assertTrue(any(item['name'] == 'Pier Park' for item in rebuilt['amusementParks']))
        self.assertTrue(any(item['lat']>42.04 for item in rebuilt['libraries']))  # Evanston, beyond Chicago.

    def test_extract_selected_relation_centers(self):
        try:
            import osmium
        except ImportError:
            self.skipTest('Optional osmium dependency is only needed when refreshing from PBF')
        xml = '''<osm version="0.6">
          <node id="1" lat="41.9" lon="-87.7"/><node id="2" lat="41.9" lon="-87.6"/>
          <node id="3" lat="42.0" lon="-87.6"/><node id="4" lat="42.0" lon="-87.7"/>
          <way id="10"><nd ref="1"/><nd ref="2"/><nd ref="3"/><nd ref="4"/><nd ref="1"/>
            <tag k="amenity" v="hospital"/><tag k="name" v="Test hospital"/></way>
          <relation id="20"><member type="way" ref="10" role="outer"/>
            <tag k="type" v="multipolygon"/><tag k="leisure" v="park"/><tag k="name" v="Test park"/></relation>
        </osm>'''
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory)/'fixture.osm'
            path.write_text(xml)
            source = pois.extract(path, 'fixture.osm')
        records = {item['osmId']: item for item in source['elements']}
        self.assertEqual(set(records), {'way/10', 'relation/20'})
        self.assertAlmostEqual(records['relation/20']['lat'], 41.95)
        self.assertAlmostEqual(records['relation/20']['lng'], -87.65)

    def test_boundaries_duplicates_and_closed_places(self):
        def record(ident, lat, lng, tags):
            return {'osmId':ident, 'lat':lat, 'lng':lng, 'tags':tags}
        result = pois.build({'elements':[
            record('node/1',41.9,-87.6,{'amenity':'hospital','name':'Hospital'}),
            record('way/2',41.90001,-87.6,{'amenity':'hospital','name':'Hospital'}),
            record('node/3',42.4,-87.6,{'amenity':'hospital'}),
            record('node/4',41.9,-87.7,{'amenity':'hospital','disused':'yes'}),
        ]})
        self.assertEqual(len(result['hospitals']),1)

if __name__ == '__main__': unittest.main()
