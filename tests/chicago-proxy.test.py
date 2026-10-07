"""Exercise the local proxy without credentials or external network calls."""
import importlib.util, io, json, os, pathlib, threading, unittest, urllib.request, urllib.error
from unittest.mock import patch
spec=importlib.util.spec_from_file_location('proxy',pathlib.Path(__file__).parents[1]/'scripts/serve-chicago-live.py')
proxy=importlib.util.module_from_spec(spec);spec.loader.exec_module(proxy)
class TestProxy(unittest.TestCase):
    def test_missing_key_and_credential_safe_upstream_failure(self):
        server=proxy.http.server.ThreadingHTTPServer(('127.0.0.1',0),proxy.Handler)
        worker=threading.Thread(target=server.serve_forever,daemon=True);worker.start()
        url=f'http://127.0.0.1:{server.server_port}/api/cta/trip-updates'
        try:
            with patch.dict(os.environ,{'CTA_GTFS_API_KEY':''}):
                with self.assertRaises(urllib.error.HTTPError) as exc:urllib.request.urlopen(url)
                self.assertEqual(exc.exception.code,503);self.assertIn('not configured',exc.exception.read().decode())
            original=urllib.request.urlopen
            def fail_upstream(request,*args,**kwargs):
                if isinstance(request,urllib.request.Request):raise RuntimeError('secret-key-must-not-leak')
                return original(request,*args,**kwargs)
            with patch.dict(os.environ,{'CTA_GTFS_API_KEY':'secret-key-must-not-leak'}),patch.object(proxy.urllib.request,'urlopen',side_effect=fail_upstream):
                with self.assertRaises(urllib.error.HTTPError) as exc:original(url)
                self.assertEqual(exc.exception.code,503);self.assertNotIn('secret-key',exc.exception.read().decode())
            fixture={'header':{'timestamp':int(proxy.time.time())},'entity':[]}
            def successful_upstream(request,*args,**kwargs):
                if isinstance(request,urllib.request.Request):
                    self.assertTrue(request.full_url.startswith(proxy.UPSTREAM+'?key='))
                    return io.BytesIO(json.dumps(fixture).encode())
                return original(request,*args,**kwargs)
            with patch.dict(os.environ,{'CTA_GTFS_API_KEY':'fixture-key'}),patch.object(proxy.urllib.request,'urlopen',side_effect=successful_upstream):
                with original(url) as response:
                    self.assertEqual(response.status,200)
                    self.assertEqual(json.load(response),fixture)
        finally:server.shutdown();server.server_close();worker.join()
if __name__=='__main__':unittest.main()
