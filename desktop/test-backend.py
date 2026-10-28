"""Verify the bundled service without installed Python or an existing map cache."""
import json
import os
from pathlib import Path
import queue
import subprocess
import tempfile
import threading
import urllib.request

root = Path(__file__).resolve().parents[1]
resources = root / 'dist' / 'win-unpacked' / 'resources'
with tempfile.TemporaryDirectory(prefix='gzw-backend-test-') as cache:
    environment = dict(os.environ, GZW_RESOURCE_ROOT=str(resources / 'map'), GZW_CACHE_DIR=cache)
    service = subprocess.Popen([str(resources / 'backend' / 'gzw-map-server.exe'), '--port', '0', '--offline'],
                               env=environment, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    try:
        lines = queue.Queue()
        def read_output():
            for line in service.stdout:
                lines.put(line)
        threading.Thread(target=read_output, daemon=True).start()
        first = lines.get(timeout=30)
        assert first.startswith('GZW_SERVER_READY '), first
        port = json.loads(first.split(' ', 1)[1])['port']
        def fetch(route):
            with urllib.request.urlopen(f'http://127.0.0.1:{port}{route}', timeout=15) as response:
                assert response.status == 200
                return response.read()
        assert b'local/runs.js' in fetch('/maps/lamang')
        assert b'All landing zones' in fetch('/__mirror/local/location-filter.js')
        assert json.loads(fetch('/__mirror/status'))['offline'] is True
        assert json.loads(fetch('/__mirror/planner-data?map=lamang'))['markers']
        assert json.loads(fetch('/__mirror/planner-data?map=ybl-1'))['markers']
        print('Bundled service passed: cold cache, offline HTML/assets, both maps and key references.')
    finally:
        service.terminate()
        service.wait(timeout=10)
        service.stdout.close()
        service.stderr.close()
