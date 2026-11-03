#!/usr/bin/env python3
"""Evidence and build contracts; these tests do not simulate game collision."""
import json
import math
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import hashlib

from build_campaign import build, native_chunks
from extract_native_route import recover
import build_nod_krai_catalog

ROOT=Path(__file__).resolve().parents[1]


class InventoryTests(unittest.TestCase):
    def test_all_native_identities_and_regions_are_preserved(self):
        data=json.loads((ROOT/'video-study/nod-krai.catalog.json').read_text())
        targets=data['targets'];ids={p['id'] for p in targets}
        self.assertEqual(len(targets),145);self.assertEqual(len(ids),145)
        self.assertEqual(sum(len(r['targetIds']) for r in data['regions']),145)
        self.assertEqual(len(data['regions']),10)
        for p in targets:self.assertEqual(p['id'],f"{p['mapName']}:{p['nativeId']}")
        self.assertTrue(all(p['routeStatus']=='not_reviewed' for p in targets))

    def test_same_numeric_id_on_two_maps_is_not_deduplicated(self):
        point=lambda region:{'id':1,'name':'fixture','country':'挪德卡莱','areas':[region],'type':'TeleportWaypoint','position':[10,20,30]}
        raw=json.dumps({'version':'fixture','data':[{'mapName':'Teyvat','sceneId':1,'points':[point('伦波岛')]},{'mapName':'MoonCanon','sceneId':2,'points':[point('月之高地')]}]}).encode()
        sha=hashlib.sha1(f'blob {len(raw)}\0'.encode()+raw).hexdigest()
        with tempfile.TemporaryDirectory() as tmp, patch.object(build_nod_krai_catalog,'SOURCE_BLOB',sha):
            p=Path(tmp)/'tp.json';p.write_bytes(raw);data=build_nod_krai_catalog.build(p)
        self.assertEqual({p['id'] for p in data['targets']},{'Teyvat:1','MoonCanon:1'})

    def test_resource_and_task_gates_have_sources(self):
        data=json.loads((ROOT/'video-study/nod-krai.campaign.json').read_text())
        level=next(g for g in data['gates'] if g['id']=='moon-offering-level-5')
        self.assertEqual(level['minimumLevel'],5)
        self.assertTrue(all(g['sources'] for g in data['gates']))
        self.assertFalse(data['fullCampaignReady'])
        for module in data['modules']:
            if module['prerequisites']:self.assertNotEqual(module['status'],'reviewed_experimental')

    def test_build_never_counts_blocked_coordinates_as_executable(self):
        plan=build();self.assertEqual(plan['catalog']['counts']['implemented'],21)
        self.assertEqual(plan['catalog']['counts']['coordinatesRecovered'],25)
        self.assertEqual(plan['catalog']['counts']['gameValidated'],0)
        self.assertFalse(plan['fullCampaignReady'])
        for m in plan['modules']:
            p=next(p for p in plan['catalog']['targets'] if p['id']==m['target'])
            self.assertEqual(p['routeStatus'],m['status'])
            self.assertEqual(p['routeId'],m['id'])

    def test_native_glide_is_continuous_and_lands_before_walking(self):
        route={'id':'contract','name':'contract','mapName':'MoonCanon','points':[
            {'x':0,'y':0,'move_mode':'walk','origin':'native-atlas-absolute'},
            *[{'x':i,'y':0,'move_mode':'fly','origin':'native-atlas-absolute'} for i in range(5,125,5)],
            {'x':125,'y':0,'move_mode':'walk','origin':'native-atlas-absolute'}]}
        with tempfile.TemporaryDirectory() as tmp:
            chunks=native_chunks(route,Path(tmp));parts=[json.loads((Path(tmp)/c['file']).read_text()) for c in chunks]
            flights=[p for p in parts if any(x['move_mode']=='fly' for x in p['positions'])]
            self.assertEqual(len(flights),1,'GPS checkpoint pauses must not change glide altitude')
            last=next(x for x in reversed(flights[0]['positions']) if x['move_mode']=='fly')
            self.assertEqual(last['action'],'stop_flying');self.assertEqual(last['type'],'target')
            self.assertTrue(all(p['info']['map_name']=='MoonCanon' for p in parts))


class RecoveryTests(unittest.TestCase):
    def audit(self, tmp, rows, **kwargs):
        p=Path(tmp);summary={'decodedToEnd':True,'duration':6,'fps':30,'sourceSha256':'fixture','mapName':'Teyvat','decodedFrames':180}
        summary.update(kwargs);(p/'summary.json').write_text(json.dumps(summary))
        (p/'frames.jsonl').write_text(''.join(json.dumps(r)+'\n' for r in rows));return p

    def rows(self):
        return [{'frame':i*6,'timeSeconds':i/5,'status':'absolute','lastAbsoluteFrame':i*6,
                 'anchorRmseGameUnits':.3,'x':i if i<=10 else 10,'y':0 if i<=10 else i-10} for i in range(26)]

    def test_recovered_points_are_observed_frames_and_keep_the_corner(self):
        with tempfile.TemporaryDirectory() as tmp:
            rows=self.rows();p=self.audit(tmp,rows);data=recover(p,0,5,[(0,'walk')])
            frames={r['frame'] for r in rows}
            self.assertTrue(all(r['sourceFrame'] in frames for r in data['points']))
            self.assertTrue(any(math.hypot(p['x']-10,p['y'])<1.1 for p in data['points']))

    def test_missing_frames_do_not_become_interpolation(self):
        with tempfile.TemporaryDirectory() as tmp:
            rows=[r for r in self.rows() if not 1<r['timeSeconds']<4]
            with self.assertRaisesRegex(ValueError,'Unlocalized gaps'):recover(self.audit(tmp,rows),0,5,[(0,'walk')])

    def test_teleport_discontinuity_is_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            rows=self.rows()
            for r in rows:
                if r['timeSeconds']>=2:r['x']+=500
            with self.assertRaisesRegex(ValueError,'discontinuity'):recover(self.audit(tmp,rows),0,5,[(0,'walk')])

    def test_partial_decode_cannot_be_exported_as_reviewed(self):
        with tempfile.TemporaryDirectory() as tmp:
            with self.assertRaisesRegex(ValueError,'decoded'):recover(self.audit(tmp,self.rows(),decodedToEnd=False),0,5,[(0,'walk')])

    def test_a_mode_cannot_be_guessed_when_missing(self):
        with tempfile.TemporaryDirectory() as tmp:
            with self.assertRaisesRegex(ValueError,'modes'):recover(self.audit(tmp,self.rows()),0,5,[])

    def test_stale_flow_cannot_fill_a_location_gap(self):
        with tempfile.TemporaryDirectory() as tmp:
            rows=self.rows()
            for r in rows:
                if r['timeSeconds']>1:r.update(status='flow',lastAbsoluteFrame=0)
            with self.assertRaisesRegex(ValueError,'Unlocalized gaps'):recover(self.audit(tmp,rows),0,5,[(0,'walk')])


if __name__=='__main__':unittest.main()
