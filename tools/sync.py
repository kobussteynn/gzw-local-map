"""Cache public pages and map data. Tiles are fetched on demand by default."""
import argparse
import base64
import concurrent.futures
import json
import re
import sys
import urllib.parse
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from server import ROOT, db, get_resource


def sync(path):
    try:
        body, mime, source = get_resource(path)
        return {'path':path,'bytes':len(body),'source':source}
    except Exception as error:
        return {'path':path,'error':str(error)}


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--all-pages', action='store_true', help='Also cache all 5,000+ individual marker pages in the sitemap')
    parser.add_argument('--workers', type=int, default=3)
    args=parser.parse_args()
    sitemap=get_resource('/sitemap.xml')[0].decode()
    paths={urllib.parse.urlsplit(url).path or '/' for url in re.findall(r'<loc>(.*?)</loc>',sitemap)}
    if not args.all_pages:
        paths={p for p in paths if '/place/' not in p}
    paths.update(['/','/changelog','/maps/lamang/settings','/maps/lamang/archive','/api/icons'])
    for map_id,map_name in ((1,'lamang'),(2,'ybl-1')):
        graph=[['__skrao',1],{'mapId':2,'mapUrl':3},map_id,map_name]
        payload=base64.urlsafe_b64encode(json.dumps(graph,separators=(',',':')).encode()).decode().rstrip('=')
        paths.add('/_app/remote/1g4p39w/fetchMapMarkers?payload='+payload)
    # Cache both page shells and SvelteKit navigation data for all primary routes.
    paths.update(p.rstrip('/')+'/__data.json' for p in list(paths) if not p.startswith(('/api/','/_app/')))
    results=[]
    with concurrent.futures.ThreadPoolExecutor(max_workers=max(1,min(args.workers,6))) as pool:
        for result in pool.map(sync,sorted(paths)):
            results.append(result)
            print(f"{len(results)}/{len(paths)} {result['path']} {'ERROR: '+result['error'] if 'error' in result else 'OK'}",flush=True)
    report={'resources':results,'errors':[r for r in results if 'error' in r]}
    (ROOT/'sync-report.json').write_text(json.dumps(report,indent=2),encoding='utf-8')
    print(f"Completed {len(results)} requests; {len(report['errors'])} errors. See sync-report.json.",flush=True)


if __name__=='__main__': main()
