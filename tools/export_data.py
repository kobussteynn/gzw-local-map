"""Export the cached public marker response into ordinary, readable JSON."""
import json
import base64
import urllib.parse
import sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from server import ROOT, db


def decode_graph(graph, index=0, memo=None):
    memo={} if memo is None else memo
    if index < 0:
        return {-1:None,-2:None,-3:None,-4:None,-5:None,-6:0}.get(index)
    if index in memo: return memo[index]
    value=graph[index]
    if isinstance(value,dict):
        result={}
        memo[index]=result
        result.update((key,decode_graph(graph,ref,memo)) for key,ref in value.items())
    elif isinstance(value,list):
        if value and isinstance(value[0],str):
            # Svelte's transport wrapper around plain input/output objects.
            result=decode_graph(graph,value[1],memo) if len(value)==2 and isinstance(value[1],int) else value
        else:
            result=[]
            memo[index]=result
            result.extend(decode_graph(graph,ref,memo) for ref in value)
    else: result=value
    memo[index]=result
    return result


def main():
    destination=ROOT/'data'
    destination.mkdir(exist_ok=True)
    with db() as conn:
        rows=conn.execute("SELECT url,body FROM responses WHERE url LIKE '%/fetchMapMarkers?%' OR url LIKE '%/api/icons'").fetchall()
        pages=conn.execute("SELECT url,body FROM responses WHERE url IN (?,?)",(\
            'https://gzwtacmap.com/maps/lamang/tasks/__data.json',\
            'https://gzwtacmap.com/maps/lamang/keys/__data.json')).fetchall()
    inventory=[]
    for url,body in rows:
        response=json.loads(body)
        if '/fetchMapMarkers?' in url:
            graph=json.loads(response['data'])
            decoded=decode_graph(graph)
            payload=decoded['_']
            encoded=urllib.parse.parse_qs(urllib.parse.urlsplit(url).query)['payload'][0]
            input_graph=json.loads(base64.urlsafe_b64decode(encoded+'='*(-len(encoded)%4)))
            map_name=decode_graph(input_graph)['mapUrl']
            name=map_name+'-markers.json'
            groups=payload['markers']
            count=sum(len(group.get('markersArray',[])) for group in groups.values())
            print(f'Exported {map_name}: {count} map markers across {len(groups)} groups.',flush=True)
            inventory.append({'file':name,'source':url,'marker_count':count,'group_count':len(groups)})
        else:
            payload=response
            name='icons.json'
            inventory.append({'file':name,'source':url})
        (destination/name).write_text(json.dumps(payload,ensure_ascii=False,indent=2),encoding='utf-8')
    for url,body in pages:
        response=json.loads(body)
        payload={}
        for node in response.get('nodes',[]):
            if node and isinstance(node.get('data'),list):
                decoded=decode_graph(node['data'])
                if isinstance(decoded,dict): payload.update(decoded)
        name='lamang-'+('tasks' if '/tasks/' in url else 'keys')+'.json'
        (destination/name).write_text(json.dumps(payload,ensure_ascii=False,indent=2),encoding='utf-8')
        inventory.append({'file':name,'source':url})
    (destination/'sources.json').write_text(json.dumps(inventory,indent=2),encoding='utf-8')


if __name__=='__main__': main()
