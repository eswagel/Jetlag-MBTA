#!/usr/bin/env python3
"""Rebuild a city elevation grid offline from the pinned USGS 3DEP float raster.
Use --refresh to explicitly download a new raster and update its recorded hash.
Requires Pillow. Source is meters; game values are international feet.
"""
import argparse
import hashlib
import json
from pathlib import Path
from urllib.parse import urlencode
from urllib.request import urlopen
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]

def decode_grid(path, response):
    image = Image.open(path)
    width, height = image.size
    if image.mode != 'F' or (width, height) != (response['width'], response['height']):
        raise ValueError('Expected an unrendered float raster matching the export dimensions')
    extent = response['extent']
    dx = (extent['xmax'] - extent['xmin']) / width
    dy = (extent['ymax'] - extent['ymin']) / height
    # ArcGIS TIFF rows go north to south; the app grid rows go south to north.
    latitudes = [round(extent['ymin']+(row+.5)*dy, 8) for row in range(height)]
    longitudes = [round(extent['xmin']+(col+.5)*dx, 8) for col in range(width)]
    values = []
    for row in range(height-1, -1, -1):
        line = [float(image.getpixel((col, row))) for col in range(width)]
        if any(not (-500 < meters < 9000) for meters in line):
            raise ValueError('Missing or implausible terrain elevation')
        values.append([round(meters / .3048, 4) for meters in line])
    return {'units':'feet', 'interpolation':'triangulated-linear', 'pointLookup':'local-grid',
            'bbox':dict(west=longitudes[0],south=latitudes[0],east=longitudes[-1],north=latitudes[-1]),
            'latStep':round(dy,8),'lngStep':round(dx,8), 'latitudes':latitudes, 'longitudes':longitudes, 'values':values}

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--refresh', action='store_true')
    parser.add_argument('--city', required=True)
    args = parser.parse_args()
    if not args.city.replace('-', '').isalnum(): raise ValueError('Invalid city id')
    sources=ROOT / 'data' / args.city / 'sources'
    manifest_path=sources / 'elevation-source.json'
    manifest=json.loads(manifest_path.read_text())
    raster_path=sources / manifest['rasterFile']
    response_path=sources / manifest['exportFile']
    output=ROOT / 'data' / args.city / 'elevation-grid.json'
    if args.refresh:
        from datetime import datetime, timezone
        with urlopen(manifest['url']+'?'+urlencode(manifest['query']), timeout=90) as r: response=json.load(r)
        if 'href' not in response: raise RuntimeError(response)
        with urlopen(response['href'], timeout=90) as r: raster=r.read()
        raster_path.write_bytes(raster)
        response_path.write_text(json.dumps(response,indent=2)+'\n')
        manifest={**manifest,'retrievedAt':datetime.now(timezone.utc).isoformat(),
                  'sha256':hashlib.sha256(raster).hexdigest(),'nativeUnits':'meters'}
        manifest_path.write_text(json.dumps(manifest,indent=2)+'\n')
    manifest=json.loads(manifest_path.read_text())
    if hashlib.sha256(raster_path.read_bytes()).hexdigest()!=manifest['sha256']:
        raise ValueError('Raster hash differs from the pinned source manifest')
    grid=decode_grid(raster_path,json.loads(response_path.read_text()))
    grid.update(city_id=args.city,dataset_version=manifest['datasetVersion'],available=True,
                source=manifest['source'],sources={'elevation':manifest})
    grid['approximation']=manifest['approximation']
    output.write_text(json.dumps(grid,separators=(',',':'))+'\n')
    print(f'Wrote {output}: {len(grid["latitudes"])} x {len(grid["longitudes"])}')
if __name__=='__main__': main()
