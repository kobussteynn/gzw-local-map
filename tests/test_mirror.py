import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
import server


class MirrorTests(unittest.TestCase):
    def test_map_service_rejects_duplicate_port_binding(self):
        with server.LocalMapServer(('127.0.0.1', 0), server.Handler) as first:
            with self.assertRaises(OSError):
                server.LocalMapServer(first.server_address, server.Handler)

    def test_runs_map_bridge_has_supported_anchors(self):
        source=(server.SNAPSHOT/'_app/immutable/chunks/DaQSydHy.js').read_text(encoding='utf-8')
        patched=server.patch_map_bridge(source)
        self.assertIn('gzw:map-ready',patched)
        self.assertIn('gzw:draw-ready',patched)
        self.assertIn('runNote',patched)
        with self.assertRaises(RuntimeError): server.patch_map_bridge('unrecognized upstream version')

    def test_planner_references_load_without_network(self):
        payload=server.planner_payload('lamang',offline=True)
        self.assertGreater(len(payload['markers']['17']['markersArray']),0)
        self.assertTrue(any(k['short_name']=='PLA H03' for k in payload['keys']))
        with self.assertRaises(ValueError): server.planner_payload('../private')

    def test_public_urls_are_localized(self):
        original=b'<a href="https://gzwtacmap.com/maps/lamang/tasks">Tasks</a><img src="https://static.gzwtacmap.com/database/a.png">'
        output=server.rewrite(original,'text/html').decode()
        self.assertIn('href="/maps/lamang/tasks"',output)
        self.assertIn('src="/__upstream/static/database/a.png"',output)

    def test_tile_template_and_binary_integrity(self):
        self.assertEqual(server.rewrite(b'`https://cdn.gzwtacmap.com/${v}/lamang/{z}/{x}/{y}.png`','text/javascript'),b'`/__upstream/cdn/${v}/lamang/{z}/{x}/{y}.png`')
        image=b'\x89PNG\r\n\x1a\n\xff\xfe'
        self.assertEqual(server.rewrite(image,'image/png'),image)

    def test_proxy_is_not_an_open_proxy(self):
        with self.assertRaises(ValueError):
            server.upstream_url('/__upstream/example.com/private')
        self.assertEqual(server.upstream_url('/__upstream/cdn/0.5/lamang/18/1/2.png'),'https://cdn.gzwtacmap.com/0.5/lamang/18/1/2.png')

    def test_offline_cache_preserves_distinct_query_payloads(self):
        with tempfile.TemporaryDirectory() as tmp, patch.object(server,'CACHE',Path(tmp)), patch.object(server,'SNAPSHOT',Path(tmp)/'snapshot'):
            with server.db() as conn:
                conn.execute('INSERT INTO responses VALUES (?,?,?,?)',(server.ORIGIN+'/api/test?payload=one',b'{"one":1}','application/json',0))
                conn.execute('INSERT INTO responses VALUES (?,?,?,?)',(server.ORIGIN+'/api/test?payload=two',b'{"two":2}','application/json',0))
            with patch('urllib.request.urlopen',side_effect=AssertionError('Offline must not use the network')):
                one=server.get_resource('/api/test?payload=one',offline=True)[0]
                two=server.get_resource('/api/test?payload=two',offline=True)[0]
                self.assertNotEqual(one,two)
                with self.assertRaises(FileNotFoundError):
                    server.get_resource('/api/missing',offline=True)

    def test_analytics_removed(self):
        html=b'<script async src="https://scripts.simpleanalyticscdn.com/latest.js"></script><main>Map</main>'
        self.assertEqual(server.rewrite(html,'text/html'),b'<main>Map</main>')


if __name__=='__main__': unittest.main()
