#!/usr/bin/env python3
"""Generate station geometry and Purple service patterns from official GTFS.
Caches raw archives outside git; --refresh explicitly updates them.
"""
import argparse, collections, csv, datetime, hashlib, io, json, pathlib, zipfile, subprocess
SOURCES = {
 'cta': 'https://www.transitchicago.com/downloads/sch_data/google_transit.zip',
 'metra': 'https://schedules.metrarail.com/gtfs/schedule.zip',
 'southshore': 'https://www.mysouthshoreline.com/google/google_transit.zip',
}
ROUTES = {'Red':'Red','Blue':'Blue','Brn':'Brown','Org':'Orange','Pink':'Pink','Y':'Yellow'}

def rows(z, name):
    path = next((n for n in z.namelist() if n.rsplit('/',1)[-1] == name), None)
    if path:
        for row in csv.DictReader(io.TextIOWrapper(z.open(path), encoding='utf-8-sig')):
            yield {k.strip():v.strip() for k,v in row.items() if k}

def station(s, prefix=''):
    return {'id':prefix+s['stop_id'], 'name':s['stop_name'], 'lat':float(s['stop_lat']), 'lng':float(s['stop_lon'])}

def seconds(t):
    h,m,s=map(int,t.split(':')); return h*3600+m*60+s

def generate(feeds, sources, generated):
    z=feeds['cta']; stops={s['stop_id']:s for s in rows(z,'stops.txt')}
    routes={r['route_id']:r for r in rows(z,'routes.txt') if r['route_type']=='1'}
    trips={t['trip_id']:t for t in rows(z,'trips.txt') if t['route_id'] in routes}
    times=collections.defaultdict(list)
    for t in rows(z,'stop_times.txt'):
        if t['trip_id'] in trips: times[t['trip_id']].append(t)
    groups=collections.defaultdict(list); patterns=[]; pattern_ids={}; service_trips=[]
    for tid, trip in trips.items():
        ts=sorted(times[tid], key=lambda s:int(s['stop_sequence']))
        ids=list(dict.fromkeys(stops[t['stop_id']].get('parent_station') or t['stop_id'] for t in ts))
        r=trip['route_id']
        if r=='G':
            if '40290' in ids: group='Green-Ashland'
            elif '40720' in ids: group='Green-Cottage'
            else: continue # short turns cannot identify a southern branch
        elif r=='P':
            group='Purple-Express' if any(float(stops[i]['stop_lat']) < 42.019 for i in ids) else 'Purple'
        else: group=ROUTES[r]
        groups[group].append((trip, ids))
        if r=='P':
            key=(group,tuple(ids))
            if key not in pattern_ids:
                pattern_ids[key]=len(patterns); patterns.append({'lineId':group,'stationIds':ids})
            service_trips.append({'id':tid,'serviceId':trip['service_id'],'pattern':pattern_ids[key],
                'start':seconds(ts[0]['departure_time']),'end':seconds(ts[-1]['arrival_time'])})
    shape_ids={t['shape_id'] for group in groups.values() for t,_ in group}
    shapes=collections.defaultdict(list)
    for s in rows(z,'shapes.txt'):
        if s['shape_id'] in shape_ids: shapes[s['shape_id']].append(s)
    lines=[]
    for group, entries in groups.items():
        # Longest station pattern, then most frequent corresponding shape: no false connector segments.
        counts=collections.Counter(t['shape_id'] for t,_ in entries)
        best=max(entries,key=lambda x:(len(x[1]),counts[x[0]['shape_id']]))[0]
        shape=sorted(shapes[best['shape_id']],key=lambda s:int(s['shape_pt_sequence']))
        ids=sorted({i for _,ids in entries for i in ids})
        lines.append({'id':group,'label':group.replace('-',' '),'color':'#'+routes[best['route_id']]['route_color'],
            'weight':4,'shapePath':[[float(s['shape_pt_lat']),float(s['shape_pt_lon'])] for s in shape],
            'stops':[station(stops[i]) for i in ids]})
    lines.sort(key=lambda l:l['id'])
    commuter=[]
    for agency in ['metra','southshore']:
        f=feeds[agency]; all_stops={s['stop_id']:s for s in rows(f,'stops.txt')}
        served={t['stop_id'] for t in rows(f,'stop_times.txt')}
        parents={all_stops[i].get('parent_station') or i for i in served}
        commuter.extend(dict(station(all_stops[i],agency+':'),agency='Metra' if agency=='metra' else 'South Shore') for i in sorted(parents))
    points=[s for l in lines for s in l['stops']]
    bbox={'west':min(s['lng'] for s in points),'south':min(s['lat'] for s in points),'east':max(s['lng'] for s in points),'north':max(s['lat'] for s in points)}
    calendar=list(rows(z,'calendar.txt')); exceptions=list(rows(z,'calendar_dates.txt'))
    service_ids={t['serviceId'] for t in service_trips}; calendar=[c for c in calendar if c['service_id'] in service_ids]; exceptions=[e for e in exceptions if e['service_id'] in service_ids]
    dates=[c[k] for c in calendar for k in ['start_date','end_date']]+[e['date'] for e in exceptions]
    version=sources['cta']['sha256']
    return ({'generatedAt':generated,'city_id':'chicago','dataset_version':'chicago-v1','feedVersion':version,'sources':sources,'bbox':bbox,'lines':lines,'commuterRail':commuter},
      {'generatedAt':generated,'feedVersion':version,'source':sources['cta'],'timezone':'America/Chicago',
       'coverage':{'start':min(dates),'end':max(dates)},'calendar':calendar,'exceptions':exceptions,'patterns':patterns,'trips':service_trips,'stopParents':{i:(s.get('parent_station') or i) for i,s in stops.items() if (s.get('parent_station') or i) in {p['id'] for p in points}}})

def main():
    p=argparse.ArgumentParser();p.add_argument('--cache-dir',default='/tmp/jetlag-gtfs-cache');p.add_argument('--output-dir',default='data/chicago');p.add_argument('--refresh',action='store_true');args=p.parse_args()
    cache=pathlib.Path(args.cache_dir);cache.mkdir(parents=True,exist_ok=True);sources={};feeds={}
    for name,url in SOURCES.items():
        path=cache/(name+'.zip'); meta=cache/(name+'.json')
        if args.refresh or not path.exists():
            raw=subprocess.check_output(['curl','--silent','--show-error','--location','--fail','--max-time','120',url])
            with zipfile.ZipFile(io.BytesIO(raw)) as z: assert any(n.endswith('stops.txt') for n in z.namelist())
            path.write_bytes(raw);meta.write_text(json.dumps({'url':url,'retrievedAt':datetime.datetime.now(datetime.timezone.utc).isoformat()}))
        raw=path.read_bytes();sources[name]=json.loads(meta.read_text()) if meta.exists() else {'url':url,'retrievedAt':None}
        sources[name]['sha256']=hashlib.sha256(raw).hexdigest(); feeds[name]=zipfile.ZipFile(io.BytesIO(raw))
    generated=max((s['retrievedAt'] for s in sources.values() if s['retrievedAt']),default=None)
    transit,calendar=generate(feeds,sources,generated);out=pathlib.Path(args.output_dir);out.mkdir(parents=True,exist_ok=True)
    for name,data in [('transit',transit),('service-calendar',calendar)]: (out/(name+'.json')).write_text(json.dumps(data,separators=(',',':'))+'\n')
    print(json.dumps({'stations':len({s['id'] for l in transit['lines'] for s in l['stops']}),'commuter':len(transit['commuterRail']),'coverage':calendar['coverage']}))
if __name__=='__main__':main()
