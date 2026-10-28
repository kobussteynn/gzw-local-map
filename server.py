"""Personal local mirror of the public GZW Tac Map client and read-only data.

No third-party packages required. Start with: python server.py
"""
from __future__ import annotations

import argparse
import base64
import concurrent.futures
from contextlib import contextmanager
import hashlib
import json
import mimetypes
import os
import re
import sqlite3
import socket
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(os.environ.get('GZW_RESOURCE_ROOT', Path(__file__).resolve().parent))
CACHE = Path(os.environ.get('GZW_CACHE_DIR', ROOT / 'cache'))
SNAPSHOT = ROOT / 'snapshot'
ORIGIN = 'https://gzwtacmap.com'
HOSTS = {'cdn': 'https://cdn.gzwtacmap.com', 'static': 'https://static.gzwtacmap.com'}
DEFAULT_VIEW = '/maps/lamang#m=18.34/7789.91/6405.92'
GATE = threading.BoundedSemaphore(6)
LOCKS = [threading.Lock() for _ in range(128)]


@contextmanager
def db():
    CACHE.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(CACHE / 'responses.sqlite3', timeout=60)
    conn.execute('PRAGMA journal_mode=WAL')
    conn.execute('CREATE TABLE IF NOT EXISTS responses (url TEXT PRIMARY KEY, body BLOB NOT NULL, mime TEXT NOT NULL, fetched REAL NOT NULL)')
    try:
        with conn:
            yield conn
    finally:
        conn.close()


def upstream_url(path):
    if path.startswith('/__upstream/'):
        parts = path.split('/', 3)
        if len(parts) != 4 or parts[2] not in HOSTS:
            raise ValueError('Unknown asset origin')
        return HOSTS[parts[2]] + '/' + parts[3]
    return ORIGIN + path


def get_resource(path, *, offline=False, refresh=False, context='/maps/lamang'):
    url = upstream_url(path)
    # Strip client-only navigation state from resource cache keys.
    lock = LOCKS[int(hashlib.sha256(url.encode()).hexdigest()[:4], 16) % len(LOCKS)]
    with lock:
        with db() as conn:
            cached = conn.execute('SELECT body,mime,fetched FROM responses WHERE url=?', (url,)).fetchone()
        immutable = '/_app/immutable/' in path or path.startswith('/__upstream/') or path.startswith('/assets/')
        if cached and (offline or not refresh and (immutable or time.time()-cached[2] < 3600)):
            return cached[0], cached[1], 'cache'
        source = (SNAPSHOT / urllib.parse.urlsplit(path).path.lstrip('/')).resolve()
        if not refresh and not urllib.parse.urlsplit(path).query and source.is_relative_to(SNAPSHOT.resolve()) and source.is_file():
            body = source.read_bytes()
            mime = mimetypes.guess_type(source.name)[0] or 'text/html'
            return body, mime, 'snapshot'
        if offline:
            if cached: return cached[0], cached[1], 'stale'
            raise FileNotFoundError('This resource has not been cached. Restart without --offline to fetch it.')
        headers = {'User-Agent': 'Mozilla/5.0 (compatible; PersonalMapMirror/1.0)', 'Accept-Encoding':'identity',
                   'x-sveltekit-pathname': context, 'x-sveltekit-search':'', 'Referer': ORIGIN + context}
        try:
            with GATE, urllib.request.urlopen(urllib.request.Request(url, headers=headers), timeout=45) as response:
                body = response.read()
                mime = response.headers.get('Content-Type', 'application/octet-stream')
            with db() as conn:
                conn.execute('INSERT OR REPLACE INTO responses VALUES (?,?,?,?)', (url, body, mime, time.time()))
            return body, mime, 'upstream'
        except Exception:
            if cached: return cached[0], cached[1], 'stale'
            raise


def rewrite(body, mime):
    if any(t in mime for t in ('text/', 'javascript', 'json', 'svg', 'xml')):
        text = body.decode('utf-8')
        text = text.replace('https://cdn.gzwtacmap.com', '/__upstream/cdn')
        text = text.replace('https://static.gzwtacmap.com', '/__upstream/static')
        text = text.replace('https://gzwtacmap.com', '')
        # Keep all site navigation local, including historical domain references.
        text = text.replace('https://gzwtacmap.online', '')
        if 'text/html' in mime:
            text = re.sub(r'<script[^>]+src="https://scripts\.simpleanalyticscdn\.com/[^>]+></script>', '', text)
            text = text.replace('</head>', '<link rel="stylesheet" href="/__mirror/local/runs.css"><script type="module" src="/__mirror/local/runs.js"></script></head>')
        if 'javascript' in mime:
            text = text.replace('https://scripts.simpleanalyticscdn.com/latest.js', '/__mirror/analytics.js')
            if 'function Lr(e,t)' in text and 'function Dr(e,t)' in text:
                text = patch_map_bridge(text)
        return text.encode('utf-8')
    return body


def patch_map_bridge(text):
    """Expose narrow map/drawing hooks without changing the captured upstream files."""
    map_anchor = 'd.map=I(p)};re(()=>{B(m,Promise.all('
    draw_anchor = '}),n.addLayer(s),R(()=>{if(o&&=(n.removeInteraction(o),null),r.freeHandMode.enabled)'
    if text.count(map_anchor) != 1 or text.count(draw_anchor) != 1:
        raise RuntimeError('The upstream map client changed. Update the Runs bridge anchors before serving this version.')
    text = text.replace(map_anchor, 'd.map=I(p);window.__gzwMap={map:I(p),state:d};window.dispatchEvent(new CustomEvent("gzw:map-ready",{detail:window.__gzwMap}))};re(()=>{B(m,Promise.all(')
    draw_code = '''window.__gzwDrawing={source:c,capture(){return c.getFeatures().map(f=>{let id=f.get("runId");if(!id){id=crypto.randomUUID();f.set("runId",id)}return{id,coordinates:f.getGeometry().getCoordinates(),color:f.get("color")||"#ffffff",dashed:!!f.get("dashed"),note:f.get("runNote")||""}})},restore(items){c.clear();l=[];for(const item of items){const f=new J(new Z(item.coordinates));f.set("runId",item.id);f.set("runNote",item.note||"");f.set("color",item.color||"#ffffff");f.set("dashed",!!item.dashed);c.addFeature(f);l.push(f)}}};window.dispatchEvent(new CustomEvent("gzw:draw-ready",{detail:window.__gzwDrawing}));'''
    text = text.replace(draw_anchor, '}),n.addLayer(s);'+draw_code+'R(()=>{if(o&&=(n.removeInteraction(o),null),r.freeHandMode.enabled)')
    text = text.replace('condition:d?()=>!0:Xe,freehandCondition:e=>d||Xe(e)', 'condition:e=>window.__gzwPlannerDraw||d||Xe(e),freehandCondition:e=>window.__gzwPlannerDraw||d||Xe(e)')
    return text.replace('!d&&u&&!e.originalEvent.shiftKey', '!window.__gzwPlannerDraw&&!d&&u&&!e.originalEvent.shiftKey')


def planner_payload(map_name, offline=False):
    from tools.export_data import decode_graph
    if map_name not in ('lamang', 'ybl-1'):
        raise ValueError('Unknown map')
    map_id = 1 if map_name == 'lamang' else 2
    graph = [['__skrao', 1], {'mapId': 2, 'mapUrl': 3}, map_id, map_name]
    encoded = base64.urlsafe_b64encode(json.dumps(graph, separators=(',', ':')).encode()).decode().rstrip('=')
    references = {}
    try:
        body, _, _ = get_resource('/_app/remote/1g4p39w/fetchMapMarkers?payload='+encoded, offline=offline)
        response = json.loads(body)
        references = decode_graph(json.loads(response['data']))['_']
    except Exception:
        fallback = ROOT / 'data' / (map_name+'-markers.json')
        if not fallback.exists(): raise
        references = json.loads(fallback.read_text(encoding='utf-8'))
    try:
        body, _, _ = get_resource('/maps/lamang/keys/__data.json', offline=offline)
        keys = []
        for node in json.loads(body).get('nodes', []):
            if node and isinstance(node.get('data'), list):
                decoded = decode_graph(node['data'])
                if isinstance(decoded, dict) and 'keysData' in decoded: keys = decoded['keysData']
    except Exception:
        keys = json.loads((ROOT/'data'/'lamang-keys.json').read_text(encoding='utf-8'))['keysData']
    return {'markers': references['markers'], 'keys': keys}


class Handler(BaseHTTPRequestHandler):
    protocol_version = 'HTTP/1.1'

    def do_HEAD(self): self.handle_request(head=True)
    def do_GET(self): self.handle_request()
    def do_POST(self): self.send_error(405, 'The personal mirror only supports public read requests')

    def handle_request(self, head=False):
        path = self.path
        try:
            parsed = urllib.parse.urlsplit(path)
            if parsed.path.startswith('/__mirror/local/'):
                relative = urllib.parse.unquote(parsed.path[len('/__mirror/local/'):])
                target = (ROOT / 'local' / relative).resolve()
                if not target.is_relative_to((ROOT/'local').resolve()) or not target.is_file():
                    return self.send_error(404)
                mime = 'text/javascript' if target.suffix in ('.js','.mjs') else mimetypes.guess_type(target.name)[0] or 'application/octet-stream'
                return self.send_bytes(target.read_bytes(), mime, head=head)
            if parsed.path == '/__mirror/planner-data':
                map_name = urllib.parse.parse_qs(parsed.query).get('map',['lamang'])[0]
                if map_name not in ('lamang','ybl-1'): return self.send_error(400, 'Unknown map')
                payload = planner_payload(map_name, self.server.offline)
                return self.send_bytes(json.dumps(payload).encode(), 'application/json', head=head)
            if path == '/__mirror/analytics.js':
                return self.send_bytes(b'/* analytics disabled in personal mirror */', 'text/javascript', head=head)
            if path == '/__mirror/status':
                with db() as conn:
                    count, size = conn.execute('SELECT COUNT(*), COALESCE(SUM(length(body)),0) FROM responses').fetchone()
                return self.send_bytes(json.dumps({'offline':self.server.offline,'cached_resources':count,'cached_bytes':size}).encode(), 'application/json', head=head)
            if not path.startswith('/') or path.startswith('//'):
                return self.send_error(400)
            body, mime, origin = get_resource(path, offline=self.server.offline, context=self.headers.get('x-sveltekit-pathname','/maps/lamang'))
            self.send_bytes(rewrite(body,mime), mime, origin=origin, head=head)
        except urllib.error.HTTPError as error:
            self.send_error(error.code, f'Public upstream returned {error.code}')
        except FileNotFoundError as error:
            self.send_error(503, str(error))
        except Exception as error:
            print(f'ERROR {path}: {error}', flush=True)
            self.send_error(502, 'Could not load upstream resource; see terminal log')

    def send_bytes(self, body, mime, *, origin='local', head=False):
        self.send_response(200)
        self.send_header('Content-Type', mime)
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'no-cache')
        self.send_header('X-Mirror-Source', origin)
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.end_headers()
        if not head: self.wfile.write(body)

    def log_message(self, fmt, *args):
        if args and str(args[1]) != '200': super().log_message(fmt,*args)


class LocalMapServer(ThreadingHTTPServer):
    # Windows SO_REUSEADDR permits another process to bind the same endpoint.
    # Exclusive binding prevents an older app from serving a newer app's UI.
    allow_reuse_address = os.name != 'nt'

    def server_bind(self):
        if os.name == 'nt':
            self.socket.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
        super().server_bind()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--port', type=int, default=4173)
    parser.add_argument('--offline', action='store_true')
    args = parser.parse_args()
    server = LocalMapServer(('127.0.0.1', args.port), Handler)
    server.daemon_threads = True
    server.offline = args.offline
    print('GZW_SERVER_READY ' + json.dumps({'port': server.server_port}), flush=True)
    print(f'Map UI directory: {ROOT}', flush=True)
    print(f'Personal GZW Tac Map: http://localhost:{args.port}{DEFAULT_VIEW}', flush=True)
    print('Read-only upstream access; downloaded resources are cached locally. Ctrl+C stops the server.', flush=True)
    try: server.serve_forever()
    except KeyboardInterrupt: pass
    finally: server.server_close()


if __name__ == '__main__': main()
