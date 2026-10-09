#!/usr/bin/env python3
"""Optional local static server + same-origin CTA proxy. CTA_GTFS_API_KEY stays server-side."""
import argparse, http.server, json, os, pathlib, threading, time, urllib.parse, urllib.request
UPSTREAM='https://transitdata.transitchicago.com/GtfsRealtime/TripUpdates.json'
CACHE={'at':0,'payload':None}; LOCK=threading.Lock()

class Handler(http.server.SimpleHTTPRequestHandler):
    def do_GET(self):
        route=urllib.parse.urlsplit(self.path).path
        if route=='/api/cta/trip-updates':
            key=os.environ.get('CTA_GTFS_API_KEY','')
            if not key:
                self.reply(503,{'error':'CTA live API key is not configured'});return
            try:
                with LOCK:
                    if not CACHE['payload'] or time.monotonic()-CACHE['at']>30:
                        url=UPSTREAM+'?'+urllib.parse.urlencode({'key':key})
                        request=urllib.request.Request(url,headers={'User-Agent':'Jetlag-Chicago/1.0','Accept':'application/json'})
                        with urllib.request.urlopen(request,timeout=4) as response:
                            payload=json.load(response)
                        if not isinstance(payload,dict) or not isinstance(payload.get('header'),dict):
                            raise ValueError('Unexpected CTA response')
                        CACHE.update(at=time.monotonic(),payload=payload)
                    payload=CACHE['payload']
                self.reply(200,payload)
            except Exception:
                # Upstream exception messages can contain the credential-bearing URL.
                self.reply(503,{'error':'CTA live feed unavailable; use the saved schedule'})
            return
        if route.startswith('/api/'):
            self.reply(404,{'error':'Unknown API path'});return
        if any(p.startswith('.') for p in pathlib.PurePosixPath(urllib.parse.unquote(route)).parts):
            self.send_error(404);return
        super().do_GET()
    def reply(self,status,payload):
        body=json.dumps(payload,separators=(',',':')).encode()
        self.send_response(status);self.send_header('Content-Type','application/json')
        self.send_header('Cache-Control','no-store');self.send_header('Content-Length',str(len(body)))
        self.end_headers();self.wfile.write(body)
    def log_message(self,format,*args):
        # Never log query strings, including accidental credentials in a client URL.
        print(self.command,urllib.parse.urlsplit(self.path).path,flush=True)

def main():
    p=argparse.ArgumentParser();p.add_argument('--port',type=int,default=8000);args=p.parse_args()
    root=pathlib.Path(__file__).resolve().parents[1]
    handler=lambda *a,**kw:Handler(*a,directory=str(root),**kw)
    server=http.server.ThreadingHTTPServer(('127.0.0.1',args.port),handler)
    print(f'Open http://127.0.0.1:{args.port}/?city=chicago; live key '+('configured' if os.environ.get('CTA_GTFS_API_KEY') else 'absent, schedule fallback'),flush=True)
    server.serve_forever()
if __name__=='__main__':main()
