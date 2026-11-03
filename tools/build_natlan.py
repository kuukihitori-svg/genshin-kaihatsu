#!/usr/bin/env python3
"""Validate the committed Natlan evidence and build an importable offline package."""
import argparse
from collections import Counter
import hashlib
import json
import math
from pathlib import Path
import re
import zipfile

ROOT = Path(__file__).resolve().parents[1]
PACKAGE = ROOT / 'bettergi/natlan'


def load(path):
    return json.loads(Path(path).read_text(encoding='utf8'))


def write(path, value):
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n', encoding='utf8')


def finite(n):
    return type(n) in (int, float) and math.isfinite(n)


def validate(catalogue, nav):
    if catalogue.get('schemaVersion') != 1 or nav.get('schemaVersion') != 1:
        raise ValueError('Unsupported catalogue or navigation schema')
    keys = set()
    for p in catalogue['points']:
        if p['key'] in keys or p['key'] != f"{p['mapName']}:{p['tpId']}":
            raise ValueError('Point identifiers must include mapName and be unique')
        keys.add(p['key'])
        if p['mapName'] not in ('Teyvat', 'AncientSacredMountain'):
            raise ValueError('Unsupported map')
        for raw, coordinate in [(p['worldPosition'], p), (p['worldArrival'], p['arrival'])]:
            if len(raw) != 3 or not all(finite(n) for n in raw):
                raise ValueError('Invalid source world coordinate')
            if [coordinate['x'], coordinate['y'], coordinate['height']] != [raw[2], raw[0], raw[1]]:
                raise ValueError('World axes were not reordered correctly')
    by_key = {p['key']: p for p in catalogue['points']}
    source = nav['source']
    if source.get('bvid') != 'BV1xysNe1Ec4' or source.get('page') != 2 or source.get('frameCount') != 9165 or source.get('decode') != 'all-frames' or \
       source.get('sha256') != 'dff9f9eb1bf34e12425db2dcaaf8c99c415d3b9ea419cab2d9ff1298fe4e93bb' or \
       source.get('audio', {}).get('status') != 'automatic-transcription-reviewed-against-picture':
        raise ValueError('Missing pinned media/frame/audio review evidence')
    alignment = nav['alignment']
    if alignment['mapName'] != 'Teyvat' or sum(p['control'] for p in alignment['points']) < 3:
        raise ValueError('Missing map control points')
    for p in alignment['points']:
        known = by_key[p['key']]
        if [p['x'], p['y']] != [known['x'], known['y']]:
            raise ValueError('Map alignment uses a different target coordinate')
        residual = math.hypot(alignment['originPixelX'] - alignment['pixelsPerGameUnit'] * p['x'] - p['pixel']['x'],
                              alignment['originPixelY'] - alignment['pixelsPerGameUnit'] * p['y'] - p['pixel']['y'])
        if not finite(residual) or residual > 3:
            raise ValueError('Map alignment residual exceeds 3px')
    fragments = {}
    for f in nav['fragments']:
        if not re.fullmatch('[a-z0-9-]+', f['id']) or f['id'] in fragments:
            raise ValueError('Duplicate or unsafe fragment id')
        fragments[f['id']] = f
        target = by_key[f['target']]
        if 'terminalApproach' in f:
            approach = f['terminalApproach']
            if not approach.get('notice') or len(approach.get('reviewInterval', [])) != 2 or f['points'][-1]['origin'] != 'source-tp':
                raise ValueError('A terminal approach must have explicit visual review and a known target')
        if len(f['points']) < 2 or not finite(f['tolerance']) or not 1 <= f['tolerance'] <= 12:
            raise ValueError('Invalid fragment shape or tolerance')
        for index, p in enumerate(f['points']):
            if not all(finite(p[k]) for k in ['x', 'y', 'timeSeconds']) or not 0 <= p['timeSeconds'] <= nav['source']['durationSeconds']:
                raise ValueError('Invalid observed coordinate or timestamp')
            if p['move_mode'] not in ('walk', 'fly', 'jump', 'climb', 'swim'):
                raise ValueError('Unknown native movement mode')
            if p['origin'] == 'sift':
                if type(p['frame']) is not int or p['absoluteInliers'] < 8 or abs(p['frame'] / 30 - p['timeSeconds']) > .01:
                    raise ValueError('Missing absolute frame evidence')
            elif p['origin'] == 'source-tp':
                q = by_key[p['sourceKey']]
                if [p['x'], p['y']] != [q['x'], q['y']] or q['mapName'] != target['mapName']:
                    raise ValueError('Wrong source target coordinates/map')
            else:
                raise ValueError('Unreviewed or synthetic coordinate cannot enter a native route')
            if index:
                previous = f['points'][index - 1]
                limit = f.get('terminalApproach', {}).get('maxDistance', 20) if index == len(f['points']) - 1 else 20
                if not finite(limit) or not 1 <= limit <= 100 or math.hypot(p['x'] - previous['x'], p['y'] - previous['y']) > limit:
                    raise ValueError('Unexplained gap between observations')
        end = f['points'][-1]
        if math.hypot(end['x'] - target['x'], end['y'] - target['y']) > 1:
            raise ValueError('Fragment does not terminate at its target')
    for g in nav['groups']:
        if g['status'] != 'reviewed-experimental' or not g['stages']:
            raise ValueError('Only reviewed experimental groups can be executable')
        for stage in g['stages']:
            start, target = by_key[stage['start']], by_key[stage['target']]
            if start['mapName'] != target['mapName'] or stage['requires']:
                raise ValueError('Unresolved prerequisite or cross-map route')
            for name in stage['fragments']:
                if fragments[name]['target'] != stage['target']:
                    raise ValueError('Fragment and stage target differ')
            first = fragments[stage['fragments'][0]]['points'][0]
            if math.hypot(first['x'] - start['arrival']['x'], first['y'] - start['arrival']['y']) > 30:
                raise ValueError('Route starts far from its declared teleport arrival')
    for map_name, witnesses in nav['witnesses'].items():
        for key in witnesses:
            if by_key[key]['mapName'] != map_name:
                raise ValueError('A verification witness belongs to another map')


def build(archive=None):
    catalogue = load(PACKAGE / 'catalogue.json')
    nav = load(ROOT / 'video-study/natlan/p2.navigation.json')
    validate(catalogue, nav)
    routes = PACKAGE / 'routes'
    routes.mkdir(exist_ok=True)
    fragments = {}
    for f in nav['fragments']:
        target = next(p for p in catalogue['points'] if p['key'] == f['target'])
        native = {'info': {'name': f['name'] + '（待实机验收）', 'type': 'collect',
                           'bgi_version': '0.66.0', 'map_name': target['mapName']},
                  'positions': [{k: p[k] for k in ['x', 'y', 'move_mode']} |
                                {'type': 'target' if i == len(f['points']) - 1 else 'path', 'action': ''}
                                for i, p in enumerate(f['points'])]}
        write(routes / (f['id'] + '.json'), native)
        fragments[f['id']] = {'id': f['id'], 'end': {k: f['points'][-1][k] for k in ['x', 'y']},
                              'tolerance': f['tolerance'], 'positions': native['positions']}
    groups = json.loads(json.dumps(nav['groups']))
    for group in groups:
        for stage in group['stages']:
            stage['fragments'] = [fragments[name] for name in stage['fragments']]
    plan = {'schemaVersion': 1, 'packageVersion': nav['packageVersion'], 'source': nav['source'],
            'groups': groups, 'witnesses': nav['witnesses']}
    plan['revision'] = hashlib.sha256(json.dumps({'catalogue': catalogue, 'navigation': nav}, sort_keys=True, ensure_ascii=False).encode()).hexdigest()
    write(PACKAGE / 'plan.json', plan)
    write(PACKAGE / 'evidence.json', nav)
    executable = {s['target'] for g in groups for s in g['stages']}
    standard = [p for p in catalogue['points'] if p['scope'] == 'standard']
    coverage = {'schemaVersion': 1, 'reference': catalogue['reference'], 'cataloguePoints': len(catalogue['points']),
                'standardTargets': len(standard), 'specialPoints': len(catalogue['points']) - len(standard),
                'experimentalRouteTargets': sorted(executable), 'realGameAcceptedTargets': [],
                'pendingStandardTargets': [p['key'] for p in standard if p['key'] not in executable],
                'maps': dict(Counter(p['mapName'] for p in catalogue['points'])),
                'notice': '目录、视频恢复路线、实机验收分别计数。本版仅自动执行5.0 P2的3→6号；1→2→3和其余分区未实现自动开图。末段神像接近存在待校准项。'}
    write(PACKAGE / 'coverage.json', coverage)
    if archive:
        destination = Path(archive).resolve()
        destination.parent.mkdir(parents=True, exist_ok=True)
        allowed = ['main.js', 'manifest.json', 'settings.json', 'README.md', 'catalogue.json', 'plan.json', 'evidence.json', 'coverage.json']
        allowed += [f"routes/{f['id']}.json" for f in nav['fragments']]
        with zipfile.ZipFile(destination, 'w', compression=zipfile.ZIP_DEFLATED) as zipped:
            for name in sorted(allowed):
                info = zipfile.ZipInfo('纳塔分区开图/' + name, date_time=(2026, 11, 4, 0, 0, 0))
                info.compress_type = zipfile.ZIP_DEFLATED
                zipped.writestr(info, (PACKAGE / name).read_bytes())
        print(destination)
    print(f"Built {len(nav['fragments'])} fragments, {len(executable)} experimental targets; {len(standard) - len(executable)} standard targets pending")


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--zip')
    build(parser.parse_args().zip)
