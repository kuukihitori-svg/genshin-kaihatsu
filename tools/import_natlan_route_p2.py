#!/usr/bin/env python3
"""Build reviewed P2 observations from the pinned, fully decoded local audit.

Media and automatic speech/OCR outputs stay outside Git. This exports coordinate
facts, paraphrased mechanics, and explicit limitations, not a copy of the video.
"""
import argparse
import json
import math
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SHA = 'dff9f9eb1bf34e12425db2dcaaf8c99c415d3b9ea419cab2d9ff1298fe4e93bb'


def write(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n', encoding='utf8')


def import_route(audit_path, asr_path, text_path):
    audit = json.loads(Path(audit_path).read_text())
    asr = json.loads(Path(asr_path).read_text())
    burned = json.loads(Path(text_path).read_text())
    if audit['mediaSha256'] != SHA or not audit['completeDecode'] or audit['frameCount'] != 9165:
        raise ValueError('Expected a complete audit of the pinned P2 source')
    if len(asr['segments']) != 63 or not burned:
        raise ValueError('Audio and visible-text review outputs are required')
    c = json.loads((ROOT / 'bettergi/natlan/catalogue.json').read_text())
    points = {p['key']: p for p in c['points']}
    rows = {r['frame']: r for r in audit['rows']}

    def observation(t, mode):
        r = rows[int(t * 30)]
        if r['status'] != 'absolute' or r.get('absoluteInliers', 0) < 8:
            raise ValueError(f'{t}s has no accepted absolute match')
        return {k: r[k] for k in ('x', 'y', 'timeSeconds', 'frame', 'absoluteInliers')} | {'origin': 'sift', 'move_mode': mode}

    def terminal(key, t, mode):
        p = points[key]
        return {'x': p['x'], 'y': p['y'], 'timeSeconds': t, 'origin': 'source-tp', 'sourceKey': key, 'move_mode': mode}

    # A continuous glide, landing and approach. Do not put a blocking position
    # check in the middle of a live glide; verify the complete landed fragment.
    to4 = [observation(t, 'walk' if t < 123 or t >= 160 else 'fly') for t in range(120, 168, 2)]
    to4 += [terminal('Teyvat:1172', 167, 'walk')]
    # Narration 219-235s identifies saurian use as a speed option. The export
    # follows the visible ground course with ordinary movement, without T/E.
    to5 = [observation(t, 'walk') for t in range(186, 235, 2)]
    to5 += [terminal('Teyvat:1177', 235, 'walk')]
    to6 = [observation(t, 'fly' if t <= 252 else 'walk') for t in range(244, 285, 2)]
    to6 += [terminal('Teyvat:1167', 298, 'jump')]
    fragments = [
        {'id': '03-04-camp', 'name': '回声之子神像至营地锚点', 'points': to4,
         'sourceInterval': [120, 168], 'target': 'Teyvat:1172', 'tolerance': 7,
         'notice': '按画面分为走向崖边、普通滑翔、落地接近；不在飞行中暂停核验。营地可能触发小龙剧情。'},
        {'id': '04-05-river', 'name': '营地至河谷锚点', 'points': to5,
         'sourceInterval': [180, 236], 'target': 'Teyvat:1177', 'tolerance': 7,
         'notice': '语音说明变龙用于加快移动；本段用普通步行跟随画面地面路线，仍需实机确认。先手动处理营地剧情。'},
        {'id': '05-06-statue', 'name': '河谷至万火之瓯神像', 'points': to6,
         'sourceInterval': [242, 301], 'target': 'Teyvat:1167', 'tolerance': 8,
         'terminalApproach': {'maxDistance': 100, 'reviewInterval': [284, 301],
                              'notice': '末段小地图进入未揭示区域，不接受后续低可信匹配。视频连续显示草地、浅台阶向神像接近；从末个可靠点交给原生跳跃接近已知神像坐标，约90坐标单位，需实机校准。'},
         'notice': '短滑翔后沿河岸行走，最后为草地和浅台阶。未将龙能力作为此段前置。'},
    ]
    stages = [{'target': f['target'], 'start': start, 'requires': [], 'fragments': [f['id']]}
              for f, start in zip(fragments, ['Teyvat:1166', 'Teyvat:1172', 'Teyvat:1177'])]
    tr = audit['alignment']
    alignment = {k: tr[k] for k in ['pixelsPerGameUnit', 'originPixelX', 'originPixelY', 'referenceFrameTime']}
    alignment['mapName'] = 'Teyvat'
    alignment['points'] = [{k: p[k] for k in ['key', 'tpId', 'videoNumber', 'pixel', 'control', 'x', 'y']} for p in tr['points']]
    alignment['maxResidualPixels'] = max(math.hypot(tr['originPixelX'] - tr['pixelsPerGameUnit'] * p['x'] - p['pixel']['x'],
                                                  tr['originPixelY'] - tr['pixelsPerGameUnit'] * p['y'] - p['pixel']['y']) for p in tr['points'])
    result = {'schemaVersion': 1, 'packageVersion': '0.1.0-experimental',
              'source': {'bvid': 'BV1xysNe1Ec4', 'page': 2,
                         'url': 'https://www.bilibili.com/video/BV1xysNe1Ec4/?p=2', 'creator': '某橙sama',
                         'title': '纳塔5.0 回声之子1—6号', 'sha256': SHA, 'durationSeconds': 305.536,
                         'frameCount': 9165, 'decode': 'all-frames', 'locatedFrameCount': 4777,
                         'visualReview': '62张5秒采样帧，以及起跳、下降、龙形态、剧情、末段台阶的原分辨率细查',
                         'audio': {'status': 'automatic-transcription-reviewed-against-picture', 'model': asr['model'], 'segments': 63,
                                   'notice': '转写包含锚点、神像等同音误识，按画面和点位资料核对；未声称逐字人工听校。'},
                         'subtitles': {'platformTrack': 'not-acquired-login-required',
                                       'burnedText': 'sampled-ocr-and-dialogue-checked', 'sampleIntervalSeconds': 3,
                                       'notice': '可见文本主要为交互、教程和剧情对白；未取得平台完整字幕轨，未声称逐条字幕验收。'}},
              'alignment': alignment,
              'review': [
                  {'interval': [13, 35], 'finding': '入口附近可触发迷林之子，解说建议先完成以取得附身能力。首版不自动接续这个任务。'},
                  {'interval': [38, 112], 'finding': '1→2→3经过嵴锋龙附身、遁地和爬升，且小地图未揭示。此段保留人工接续，不输出猜测坐标。'},
                  {'interval': [120, 168], 'finding': '3→4为普通起跳滑翔并落地接近营地锚点。编号计数不作为解锁证明。'},
                  {'interval': [169, 179], 'finding': '营地触发剧情。脚本等待主界面定位恢复，超时停下供玩家处理后重跑。'},
                  {'interval': [219, 235], 'finding': '解说把匿叶龙能力解释为赶路加速。首版不盲按T/E附身，普通步行替代需实机确认。'},
                  {'interval': [284, 301], 'finding': '靠近6号时小地图未揭示区域增加，弃用低可信匹配；最后草地和浅台阶接近单独标记为待实机校准。'},
              ], 'fragments': fragments,
              'groups': [{'id': 'p2-03-06', 'name': '5.0首批：3→6（回声之子神像已开）', 'status': 'reviewed-experimental', 'stages': stages}] +
                        [{'id': f'p2-only-{i}', 'name': name, 'status': 'reviewed-experimental', 'stages': [stage]}
                         for i, name, stage in zip([4, 5, 6], ['仅3→4：滑翔至营地', '仅4→5：营地至河谷', '仅5→6：河谷至神像'], stages)],
              'witnesses': {'Teyvat': ['Teyvat:1170', 'Teyvat:1166'],
                            'AncientSacredMountain': ['AncientSacredMountain:2', 'AncientSacredMountain:3']}}
    write(ROOT / 'video-study/natlan/p2.navigation.json', result)
    print('Imported 3 experimental stages with', sum(len(f['points']) for f in fragments), 'source-qualified points')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--audit', required=True)
    parser.add_argument('--asr', required=True)
    parser.add_argument('--burned-text', required=True)
    args = parser.parse_args()
    import_route(args.audit, args.asr, args.burned_text)
