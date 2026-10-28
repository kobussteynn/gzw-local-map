"""Download public client dependencies to inspect the map's data sources."""
import concurrent.futures, json, re, urllib.request, urllib.parse
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BASE = 'https://gzwtacmap.com'
DEST = ROOT / 'snapshot'
def fetch(path):
    url = BASE + path
    dest = DEST / path.lstrip('/')
    try:
        if dest.exists():
            body = dest.read_bytes()
        else:
            with urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent':'Mozilla/5.0'}), timeout=40) as res:
                body = res.read()
            dest.parent.mkdir(parents=True, exist_ok=True)
            dest.write_bytes(body)
        refs = set()
        if dest.suffix in ('.js', '.css', '.html') or not dest.suffix:
            text = body.decode('utf-8')
            for ref in re.findall(r'''["'(]([^"'()\s<>]+\.(?:js|css|woff2?|png|svg|webp|jpg))(?:["')])''', text):
                if not ref.startswith(('.', '/', 'https://')): continue
                target = urllib.parse.urljoin(url, ref)
                if urllib.parse.urlsplit(target).netloc == 'gzwtacmap.com':
                    refs.add(urllib.parse.urlsplit(target).path)
        return path, refs, None
    except Exception as e:
        return path, set(), str(e)

if __name__ == '__main__':
    with urllib.request.urlopen(BASE+'/maps/lamang', timeout=40) as response:
        html=response.read().decode('utf-8')
    (DEST/'maps').mkdir(parents=True,exist_ok=True)
    (DEST/'maps'/'lamang').write_text(html,encoding='utf-8')
    pending = {'/maps/lamang'}
    pending.update(urllib.parse.urlsplit(urllib.parse.urljoin(BASE+'/maps/lamang',ref)).path for ref in re.findall(r'import\("([^"]+)"\)',html))
    seen = set()
    errors = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:
        while pending:
            batch = pending - seen
            if not batch: break
            seen.update(batch)
            pending = set()
            for path, refs, error in pool.map(fetch, sorted(batch)):
                pending.update(refs - seen)
                if error: errors.append([path,error])
            print(f'Downloaded/checked {len(seen)} dependencies; {len(pending)} remaining', flush=True)
    (ROOT/'asset-inspection.json').write_text(json.dumps({'paths':sorted(seen),'errors':errors},indent=2))
