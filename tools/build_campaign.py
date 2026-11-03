#!/usr/bin/env python3
"""Build the experimental region runner; never turn an inventory into a path."""
import argparse
import hashlib
import json
import math
from pathlib import Path
import zipfile

ROOT=Path(__file__).resolve().parents[1]
PACKAGE=ROOT/'bettergi/nod-krai-all'


def read(path): return json.loads(path.read_text(encoding='utf-8'))
def write(path,data):
    path.parent.mkdir(parents=True,exist_ok=True)
    path.write_text(json.dumps(data,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')


def native_chunks(route, folder):
    points=[]
    for i,p in enumerate(route['points']):
        if p['origin'] not in ('native-atlas-absolute','native-atlas-flow'):
            raise ValueError('Campaign navigation requires an observed native-atlas pose')
        if not all(math.isfinite(p[k]) for k in ('x','y')):raise ValueError('Invalid coordinate')
        stop=p['move_mode']=='fly' and (i==len(route['points'])-1 or route['points'][i+1]['move_mode']!='fly')
        points.append({'x':p['x'],'y':p['y'],'move_mode':p['move_mode'],
                       'type':'target' if stop or i==len(route['points'])-1 else 'path',
                       'action':'stop_flying' if stop else ''})
    chunks=[];start=0;length=0
    for i,p in enumerate(points):
        if i:length+=math.hypot(p['x']-points[i-1]['x'],p['y']-points[i-1]['y'])
        last=i==len(points)-1;ground=p['move_mode'] in ('walk','run')
        next_mode=points[i+1]['move_mode'] if not last else None
        if not last and not (ground and i>start and (length>=28 or next_mode!=p['move_mode'])):continue
        part=[dict(x) for x in points[start:i+1]]
        if ground or last:part[-1]['type']='target'
        filename=f"routes/{route['id']}.part{len(chunks)+1:02d}.json"
        write(folder/filename,{'info':{'name':route['name']+'（视频恢复，未实机验收）','type':'collect','bgi_version':'0.66.0','map_name':route['mapName']},'positions':part})
        chunks.append({'file':filename,'end':{'x':p['x'],'y':p['y']}});start=i;length=0
    if not chunks:raise ValueError('Empty route')
    return chunks


def build(archive=None):
    catalog=read(ROOT/'video-study/nod-krai.catalog.json')
    evidence=read(ROOT/'video-study/nod-krai.campaign.json')
    targets={p['id']:p for p in catalog['targets']}
    routes={r['id']:r for r in evidence['routes']};modules=evidence['modules']
    implemented=set()
    active_files=set()
    for m in modules:
        if m['status']!='reviewed_experimental':
            if m['target'] in targets:
                targets[m['target']]['routeStatus']=m['status'];targets[m['target']]['routeId']=m['id']
                targets[m['target']]['prerequisites']=m['prerequisites']
            continue
        a,b=targets[m['from']],targets[m['target']]
        if m['prerequisites']:raise ValueError('An unresolved prerequisite cannot count as an implemented route')
        if a['mapName']!=b['mapName']:raise ValueError('A cross-map transition needs its own reviewed mechanism')
        for step in m['steps']:
            if step['kind'] not in ('navigate','rest'):raise ValueError('Unsupported mechanism cannot enter the runner')
            if step['kind']=='rest':
                if not 100<=step['milliseconds']<=15000:raise ValueError('Invalid rest bound')
                continue
            r=routes[step['route']]
            if r['mapName']!=b['mapName']:raise ValueError('Wrong map name in route')
            r['nativeChunks']=native_chunks(r,PACKAGE)
            active_files.update(c['file'] for c in r['nativeChunks'])
        first=routes[next(s['route'] for s in m['steps'] if s['kind']=='navigate')]['points'][0]
        last=routes[next(s['route'] for s in reversed(m['steps']) if s['kind']=='navigate')]['points'][-1]
        if math.hypot(first['x']-a['arrival']['x'],first['y']-a['arrival']['y'])>35:raise ValueError('Route start does not match its native teleport arrival')
        if math.hypot(last['x']-b['position']['x'],last['y']-b['position']['y'])>12:raise ValueError('Route end does not match the reviewed target')
        targets[m['target']]['routeStatus']='reviewed_experimental';targets[m['target']]['routeId']=m['id'];implemented.add(m['target'])
    for p in (PACKAGE/'routes').glob('*.part*.json'):
        if str(p.relative_to(PACKAGE)) not in active_files:p.unlink()
    for region in catalog['regions']:
        region['coverage']['implemented']=sum(t in implemented for t in region['targetIds'])
    catalog['status']='partial_experimental_routes';catalog['counts']['implemented']=len(implemented)
    catalog['counts']['coordinatesRecovered']=len({m['target'] for m in modules})
    catalog['counts']['gameValidated']=0
    plan={'schemaVersion':1,'packageVersion':'0.3.0-development','fullCampaignReady':False,
          'notice':'Full inventory; partial experimental routes only. Blocked and unreviewed points are never counted as completed.',
          'catalog':catalog,'modules':modules,'routes':list(routes.values()),'gates':evidence['gates']}
    plan['planSha256']=hashlib.sha256(json.dumps(plan,ensure_ascii=False,sort_keys=True,separators=(',',':')).encode()).hexdigest()
    write(PACKAGE/'plan.json',plan)
    if archive:
        archive=Path(archive);archive.parent.mkdir(parents=True,exist_ok=True)
        with zipfile.ZipFile(archive,'w',compression=zipfile.ZIP_DEFLATED) as z:
            for p in sorted(PACKAGE.rglob('*')):
                if p.is_file() and not any(s in ('logs','state.json','coverage-report.json') for s in p.relative_to(PACKAGE).parts):z.write(p,Path('挪德卡莱分区开图开发版')/p.relative_to(PACKAGE))
        print(archive)
    print(f'{len(implemented)}/{len(targets)} targets have experimental routes; 0 game validated')
    return plan


if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--zip');build(p.parse_args().zip)
