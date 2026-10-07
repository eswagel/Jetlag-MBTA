import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from PIL import Image
ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('raster',ROOT/'scripts/generate-raster-elevation.py')
raster=importlib.util.module_from_spec(spec);spec.loader.exec_module(raster)
class RasterTests(unittest.TestCase):
    def test_pixel_centers_orientation_and_units(self):
        with tempfile.TemporaryDirectory() as temp:
            p=Path(temp)/'example.tif'
            image=Image.new('F',(2,2));image.putdata([30.48,60.96,91.44,121.92]);image.save(p)
            grid=raster.decode_grid(p,{'width':2,'height':2,'extent':{'xmin':0,'xmax':2,'ymin':0,'ymax':2}})
            self.assertEqual(grid['latitudes'],[.5,1.5]);self.assertEqual(grid['longitudes'],[.5,1.5])
            self.assertEqual(grid['values'],[[300,400],[100,200]])
    def test_pinned_grid_rebuild(self):
        sources=ROOT/'data/chicago/sources'
        expected=json.loads((ROOT/'data/chicago/elevation-grid.json').read_text())
        actual=raster.decode_grid(sources/'elevation-3dep.tif',json.loads((sources/'elevation-3dep-export.json').read_text()))
        for key in actual:self.assertEqual(actual[key],expected[key])
if __name__=='__main__':unittest.main()
