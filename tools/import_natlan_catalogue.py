#!/usr/bin/env python3
"""Extract scene-qualified Natlan points from a pinned BetterGI tp.json."""
import argparse
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def import_catalogue(reference):
    raw = Path(reference).read_bytes()
    data = json.loads(raw)
    points = []
    standard = {'Goddess', 'TeleportWaypoint', 'MasteryDomain', 'ForgeryDomain', 'BlessDomain', 'TrounceDomain'}
    for scene in data['data']:
        for point in scene['points']:
            if point.get('country') != '纳塔':
                continue
            p, arrival = point['position'], point['tranPosition']
            points.append({
                'key': f"{scene['mapName']}:{point['id']}", 'tpId': point['id'],
                'sceneId': scene['sceneId'], 'mapName': scene['mapName'],
                'name': point['name'], 'type': point['type'], 'areas': point['areas'],
                'scope': 'standard' if point['type'] in standard else 'special',
                'worldPosition': p, 'worldArrival': arrival,
                'x': p[2], 'y': p[0], 'height': p[1],
                'arrival': {'x': arrival[2], 'y': arrival[0], 'height': arrival[1]},
            })
    result = {'schemaVersion': 1, 'coordinateSystem': 'bettergi-pathing-v1',
              'reference': {'repository': 'babalae/better-genshin-impact', 'ref': '0.66.0',
                            'commit': '0af68c28f6b0e714d5304625ce644736d508022e',
                            'path': 'BetterGenshinImpact/GameTask/AutoTrackPath/Assets/tp.json',
                            'blobSha': 'f0cc04464dfa28511b383ada32a1422cb665ceb8',
                            'dataVersion': data['version'], 'sha256': hashlib.sha256(raw).hexdigest(),
                            'axes': 'x=position[2], y=position[0], height=position[1]'},
              'notice': '这是固定版本的点位目录。收录点位不代表已有可执行路线或已解锁。远古圣山使用独立地图。',
              'points': points}
    destination = ROOT / 'bettergi/natlan/catalogue.json'
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n', encoding='utf8')
    print(f'Imported {len(points)} scene-qualified Natlan points')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('reference')
    import_catalogue(parser.parse_args().reference)
