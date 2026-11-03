#!/usr/bin/env python3
"""Recover an explicitly reviewed movement interval from a sequential audit.

Missing poses remain gaps. This tool neither joins teleports/cutscenes nor infers
movement modes, mechanisms, floors, or successful unlocks from XY proximity.
"""
import argparse
import bisect
import json
import math
from pathlib import Path


def distance(a, b):
    return math.hypot(a['x']-b['x'], a['y']-b['y'])


def recover(audit, start, end, modes, max_gap=1.2, spacing=6.0):
    audit = Path(audit)
    summary = json.loads((audit/'summary.json').read_text())
    if not summary['decodedToEnd']:
        raise ValueError('The source was not decoded to its end')
    if not 0 <= start < end <= summary['duration']:
        raise ValueError('Invalid source interval')
    if not modes or modes[0][0] != start or any(m[1] not in ('walk','run','fly','climb','jump') or not math.isfinite(m[0]) or not start<=m[0]<=end for m in modes) or any(b[0]<=a[0] for a,b in zip(modes,modes[1:])):
        raise ValueError('Explicit movement modes must begin at the interval start')
    rows = []
    with (audit/'frames.jsonl').open() as stream:
        for line in stream:
            r = json.loads(line)
            if start <= r['timeSeconds'] <= end and r['status'] in ('absolute','flow'):
                if r['frame']-r['lastAbsoluteFrame'] <= summary['fps'] and r['anchorRmseGameUnits'] <= 1:
                    if not all(math.isfinite(r[k]) for k in ('x','y','timeSeconds')):raise ValueError('Non-finite pose')
                    rows.append(r)
    if not rows:
        raise ValueError('No absolute or recently anchored poses in the interval')
    gaps = []
    for a,b in zip(rows, rows[1:]):
        dt = b['timeSeconds']-a['timeSeconds']
        if dt<=0:raise ValueError('Non-monotonic source timestamps')
        if dt > max_gap:
            gaps.append([a['timeSeconds'],b['timeSeconds']])
        if distance(a,b) > max(10,dt*26):
            raise ValueError(f'Position discontinuity at {a["timeSeconds"]}–{b["timeSeconds"]}')
    if rows[0]['timeSeconds']-start > max_gap:
        gaps.insert(0,[start,rows[0]['timeSeconds']])
    if end-rows[-1]['timeSeconds'] > max_gap:
        gaps.append([rows[-1]['timeSeconds'],end])
    if gaps:
        raise ValueError(f'Unlocalized gaps require a separate review, not interpolation: {gaps}')
    # Sample the observed curve before simplification, retaining turnbacks. End
    # points and movement transitions are mandatory, not inferred from velocity.
    selected = [rows[0]]
    for row in rows[1:]:
        if row['timeSeconds']-selected[-1]['timeSeconds'] >= .2 and distance(row,selected[-1]) >= 1:
            selected.append(row)
    if selected[-1] != rows[-1]: selected.append(rows[-1])
    mode_times = [m[0] for m in modes]
    def mode(row): return modes[bisect.bisect_right(mode_times,row['timeSeconds'])-1][1]
    # Keep a point whenever the intervening curve leaves a .65 unit corridor,
    # spacing exceeds the limit, or a mode changes. No coordinates are invented.
    kept = [selected[0]];pending=[]
    for row in selected[1:]:
        a=kept[-1];dx=row['x']-a['x'];dy=row['y']-a['y'];length=math.hypot(dx,dy)
        bend=max((abs(dx*(p['y']-a['y'])-dy*(p['x']-a['x']))/max(length,.001) for p in pending),default=0)
        turnback=any((p['x']-a['x'])*dx+(p['y']-a['y'])*dy<-.5 for p in pending)
        if pending and (length>spacing or bend>.65 or turnback or mode(row)!=mode(a)):
            kept.append(pending[-1]);pending=[]
        pending.append(row)
    if kept[-1] != selected[-1]:kept.append(selected[-1])
    points=[{'x':round(r['x'],3),'y':round(r['y'],3),'move_mode':mode(r),
             'timeSeconds':r['timeSeconds'],'sourceFrame':r['frame'],
             'origin':'native-atlas-'+r['status'],'absoluteFrame':r['lastAbsoluteFrame'],
             'anchorRmseGameUnits':r['anchorRmseGameUnits']} for r in kept]
    return {'sourceSha256':summary['sourceSha256'],'mapName':summary['mapName'],
            'sourceRange':[start,end],'decodedFrames':summary['decodedFrames'],
            'posesInInterval':len(rows),'maxUnlocalizedGapSeconds':round(max(b['timeSeconds']-a['timeSeconds'] for a,b in zip(rows,rows[1:])),4) if len(rows)>1 else 0,
            'atlasCoordinateSystem':'native-1024-map-origin-minus-pixel','points':points,
            'reviewStatus':'coordinates_recovered_requires_movement_and_mechanism_review'}


if __name__ == '__main__':
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--audit',required=True);p.add_argument('--start',type=float,required=True)
    p.add_argument('--end',type=float,required=True);p.add_argument('--mode',choices=['walk','run','fly','climb','jump'],required=True)
    p.add_argument('--out',required=True)
    a=p.parse_args();data=recover(a.audit,a.start,a.end,[(a.start,a.mode)])
    Path(a.out).write_text(json.dumps(data,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
