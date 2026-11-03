#!/usr/bin/env python3
"""Regression checks for evidence boundaries, coordinate maps and release contents."""
import copy
import hashlib
import json
from pathlib import Path
import shutil
import tempfile
import unittest
import zipfile

import build_natlan as build

CATALOGUE = build.load(build.PACKAGE / 'catalogue.json')
NAV = build.load(build.ROOT / 'video-study/natlan/p2.navigation.json')


class NatlanBuildTests(unittest.TestCase):
    def reject(self, change_catalogue=None, change_navigation=None):
        catalogue, navigation = copy.deepcopy(CATALOGUE), copy.deepcopy(NAV)
        if change_catalogue:
            change_catalogue(catalogue)
        if change_navigation:
            change_navigation(navigation)
        with self.assertRaises((ValueError, KeyError)):
            build.validate(catalogue, navigation)

    def test_reference_counts_are_distinct_from_executable_coverage(self):
        build.validate(CATALOGUE, NAV)
        self.assertEqual(len(CATALOGUE['points']), 167)
        self.assertEqual(sum(p['scope'] == 'standard' for p in CATALOGUE['points']), 159)
        self.assertEqual(sum(p['mapName'] == 'AncientSacredMountain' for p in CATALOGUE['points']), 19)
        coverage = build.load(build.PACKAGE / 'coverage.json')
        self.assertEqual(len(coverage['experimentalRouteTargets']), 3)
        self.assertEqual(len(coverage['pendingStandardTargets']), 156)
        self.assertEqual(coverage['realGameAcceptedTargets'], [])

    def test_raw_world_axes_cannot_be_used_as_route_xy(self):
        self.reject(change_catalogue=lambda c: c['points'][0].update(x=c['points'][0]['worldPosition'][0]))

    def test_teleport_arrival_must_use_tran_position_axes(self):
        self.reject(change_catalogue=lambda c: c['points'][0]['arrival'].update(x=c['points'][0]['x']))

    def test_map_qualified_identifiers_are_mandatory(self):
        self.reject(change_catalogue=lambda c: c['points'][0].update(key=str(c['points'][0]['tpId'])))

    def test_cross_map_route_is_rejected(self):
        self.reject(change_navigation=lambda n: n['groups'][0]['stages'][0].update(start='AncientSacredMountain:2'))

    def test_cross_map_witness_is_rejected(self):
        self.reject(change_navigation=lambda n: n['witnesses']['AncientSacredMountain'].__setitem__(0, 'Teyvat:1170'))

    def test_synthetic_interpolation_cannot_become_a_native_point(self):
        self.reject(change_navigation=lambda n: n['fragments'][0]['points'][1].update(origin='interpolated'))

    def test_low_confidence_or_wrong_frame_evidence_is_rejected(self):
        self.reject(change_navigation=lambda n: n['fragments'][0]['points'][1].update(absoluteInliers=2))
        self.reject(change_navigation=lambda n: n['fragments'][0]['points'][1].update(frame=1))

    def test_incomplete_media_or_audio_review_is_rejected(self):
        self.reject(change_navigation=lambda n: n['source'].update(decode='sampling-only'))
        self.reject(change_navigation=lambda n: n['source']['audio'].update(status='not-acquired'))

    def test_bad_control_point_cannot_pass_map_alignment(self):
        self.reject(change_navigation=lambda n: n['alignment']['points'][0]['pixel'].update(x=0))

    def test_unknown_source_target_coordinate_is_rejected(self):
        self.reject(change_navigation=lambda n: n['fragments'][0]['points'][-1].update(x=1))

    def test_unexplained_large_gap_is_rejected(self):
        self.reject(change_navigation=lambda n: n['fragments'][0]['points'][2].update(x=9000))

    def test_terminal_exception_must_be_bounded_and_documented(self):
        self.reject(change_navigation=lambda n: n['fragments'][2].pop('terminalApproach'))
        self.reject(change_navigation=lambda n: n['fragments'][2]['terminalApproach'].update(maxDistance=1000))
        self.reject(change_navigation=lambda n: n['fragments'][2]['terminalApproach'].update(notice=''))

    def test_unknown_fragment_name_and_unresolved_prerequisite_are_rejected(self):
        self.reject(change_navigation=lambda n: n['fragments'][0].update(id='../unsafe'))
        self.reject(change_navigation=lambda n: n['groups'][0]['stages'][0].update(requires=['unreviewed quest']))

    def test_unreviewed_group_is_not_executable(self):
        self.reject(change_navigation=lambda n: n['groups'][0].update(status='unreviewed'))

    def test_route_start_cannot_drift_from_its_teleport(self):
        self.reject(change_navigation=lambda n: n['groups'][0]['stages'][0].update(start='Teyvat:1170'))

    def test_archive_is_reproducible_and_excludes_all_user_data(self):
        original = build.PACKAGE
        with tempfile.TemporaryDirectory() as temporary:
            copied = Path(temporary) / 'package'
            shutil.copytree(original, copied)
            (copied / 'logs').mkdir()
            for name in ['state.json', 'native-check.json', 'unlock-report.json', 'logs/private.txt', 'unexpected.txt']:
                (copied / name).write_text('private-runtime-data', encoding='utf8')
            build.PACKAGE = copied
            try:
                a, b = Path(temporary) / 'a.zip', Path(temporary) / 'b.zip'
                build.build(a)
                build.build(b)
                self.assertEqual(hashlib.sha256(a.read_bytes()).digest(), hashlib.sha256(b.read_bytes()).digest())
                with zipfile.ZipFile(a) as z:
                    names = z.namelist()
                    self.assertEqual(len(names), 11)
                    self.assertTrue(all(name.startswith('纳塔分区开图/') for name in names))
                    self.assertTrue(all(b'private-runtime-data' not in z.read(name) for name in names))
                    manifest = json.loads(z.read('纳塔分区开图/manifest.json'))
                    self.assertIn('纳塔分区开图/' + manifest['main'], names)
                    self.assertIn('纳塔分区开图/' + manifest['settings_ui'], names)
            finally:
                build.PACKAGE = original


if __name__ == '__main__':
    unittest.main()
