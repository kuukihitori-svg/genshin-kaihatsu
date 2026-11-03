#!/usr/bin/env python3
"""Build a complete native point inventory; an inventory is not a walkable route."""
import argparse
import hashlib
import json
from pathlib import Path

from video_study import project_tp


SOURCE_BLOB = 'f0cc04464dfa28511b383ada32a1422cb665ceb8'
GROUPS = [
    ('伦波岛','Teyvat','6.0'), ('希汐岛','Teyvat','6.0'), ('帕哈岛','Teyvat','6.0'),
    ('虚海望','Teyvat','6.3'), ('逐浪野','Teyvat','6.3'), ('烟硌山峰','Teyvat','6.3'),
    ('杜南纳深坑','Teyvat','6.7'), ('月之高地','MoonCanon','6.7'),
    ('月荡海','MoonCanon','6.7'), ('月之暗面','MoonCanon','6.7'),
]


def build(source):
    raw=Path(source).read_bytes()
    blob=hashlib.sha1(f'blob {len(raw)}\0'.encode()+raw).hexdigest()
    if blob!=SOURCE_BLOB:
        raise ValueError('Native point source changed; review its map names and coverage before rebuilding')
    data=json.loads(raw)
    nodes=[];identities=set()
    for scene in data['data']:
        for point in scene['points']:
            if point.get('country')!='挪德卡莱':continue
            name=scene['mapName'];identifier=f'{name}:{point["id"]}'
            if identifier in identities:raise ValueError('Duplicate point identity')
            identities.add(identifier)
            group=next((g for g in GROUPS if g[0]==point['areas'][0] and g[1]==name),None)
            if not group:raise ValueError('A new area needs an explicit campaign group')
            nodes.append({'id':identifier,'nativeId':point['id'],'mapName':name,'sceneId':scene['sceneId'],
                          'name':point['name'],'kind':point['type'],'areas':point['areas'],
                          'region':group[0],'introducedIn':group[2],
                          'position':project_tp(point['position']),
                          'arrival':project_tp(point.get('tranPosition',point['position'])),
                          'routeStatus':'not_reviewed','routeId':None,'prerequisites':[],
                          'notice':'Native point identity and coordinates only; no traversable path inferred.'})
    regions=[]
    for region,name,version in GROUPS:
        selected=[p for p in nodes if p['region']==region]
        regions.append({'id':region,'mapName':name,'introducedIn':version,'targetIds':[p['id'] for p in selected],
                        'coverage':{'total':len(selected),'implemented':0,'gameValidated':0}})
    counts={kind:sum(p['kind']==kind for p in nodes) for kind in sorted({p['kind'] for p in nodes})}
    return {'schemaVersion':1,'scope':'All native 挪德卡莱 points in BetterGI 0.66.0, including MoonCanon and meeting points',
            'status':'inventory_and_evidence_collection','source':{
                'url':'https://github.com/babalae/better-genshin-impact/blob/0.66.0/BetterGenshinImpact/GameTask/AutoTrackPath/Assets/tp.json',
                'gitBlobSha':blob,'sha256':hashlib.sha256(raw).hexdigest(),'nativeDataVersion':data['version']},
            'counts':{'total':len(nodes),'regions':len(regions),'byKind':counts},
            'regions':regions,'targets':nodes,
            'rules':['A target coordinate does not establish a navigable route.',
                     'MoonCanon positions and Teyvat positions must never share a matcher or teleport map name.',
                     'Task prerequisites and mechanisms require timestamped video evidence.',
                     'Unknown or unreviewed steps cannot be counted as completed.']}


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--tp-source',required=True);parser.add_argument('--out',required=True)
    args=parser.parse_args()
    result=build(args.tp_source)
    Path(args.out).write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    print(json.dumps(result['counts'],ensure_ascii=False))
