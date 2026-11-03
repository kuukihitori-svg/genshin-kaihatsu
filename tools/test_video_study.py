"""Offline contract tests; tiny generated media is synthetic test data."""
import argparse
import copy
import json
from pathlib import Path
import tempfile
import unittest

import video_study as v


def fixture():
    return {"schemaVersion": 1,
        "source": {"bvid": "BV1XSHDzqE2h", "page": 2,
                   "url": "https://www.bilibili.com/video/BV1XSHDzqE2h/?p=2"},
        "durationSeconds": 3,
        "segments": [{"id": "test", "title": "合成测试路线", "startSeconds": 0,
            "endSeconds": 3, "observation": "Synthetic fixture, no game data",
            "unknowns": [], "evidence": [{"timeSeconds": 0, "description": "test start"},
                                          {"timeSeconds": 2, "description": "test end"}],
            "route": {"status": "reviewed", "coordinateSystem": "bettergi-pathing-v1",
                "mapLayer": "Teyvat/surface", "startUnlocked": True, "positions": [
                    {"x": 10, "y": -20, "type": "teleport", "move_mode": "walk",
                     "coordinateSource": "synthetic test", "evidenceTimeSeconds": 0},
                    {"x": 12, "y": -22, "type": "target", "move_mode": "walk",
                     "coordinateSource": "synthetic test", "evidenceTimeSeconds": 2}]}}]}


class ContractTests(unittest.TestCase):
    def test_tp_axes_are_reordered_and_height_is_preserved(self):
        self.assertEqual(v.project_tp([1425.7, 204.3502, 9364.397]),
                         {"x": 9364.397, "y": 1425.7, "height": 204.3502})

    def test_map_alignment_cross_checks_points_and_rejects_degenerate_anchors(self):
        data = {"orientation": "north-up", "mapLayer": "Teyvat/surface", "source": {}, "reference": {}, "frame": {},
            "points": [{"worldPosition": [y, 100, x], "pixel": {"x": 100-2*x, "y": 80-2*y}, "control": True}
                       for x, y in ((0, 0), (10, 0), (0, 10))]}
        result = v.align_map(data)
        self.assertEqual(result["transform"]["pixelsPerGameUnit"], 2)
        self.assertEqual(result["maxResidualPixels"], 0)
        bad = copy.deepcopy(data); bad["points"][2] = copy.deepcopy(bad["points"][1])
        with self.assertRaises(v.StudyError): v.align_map(bad)
        bad = copy.deepcopy(data)
        bad["points"].append({"worldPosition": [10, 100, 10], "pixel": {"x": 50, "y": 50}})
        with self.assertRaises(v.StudyError): v.align_map(bad)

    def test_url_part_is_explicit_and_shell_strings_are_rejected(self):
        self.assertEqual(v.parse_source("https://www.bilibili.com/video/BV1XSHDzqE2h/?p=2")["page"], 2)
        for url in ("https://evil.test/video/BV1XSHDzqE2h/?p=2",
                    "https://www.bilibili.com/video/BV1XSHDzqE2h/?p=0",
                    "https://www.bilibili.com/video/BV1XSHDzqE2h/?p=2&p=3",
                    "https://www.bilibili.com/video/BV1XSHDzqE2h/?p=$(id)"):
            with self.subTest(url=url), self.assertRaises(v.StudyError):
                v.parse_source(url)

    def test_evidence_must_belong_to_segment(self):
        d = fixture(); d["segments"][0]["evidence"][0]["timeSeconds"] = 10
        with self.assertRaises(v.StudyError): v.validate_study(d)

    def test_wrong_video_part_is_not_accepted(self):
        m = {"source": {"bvid": "BV1XSHDzqE2h", "page": 1}, "durationSeconds": 3}
        with self.assertRaises(v.StudyError): v.validate_study(fixture(), m)

    def test_nonfinite_boolean_times_and_duplicate_ids_fail(self):
        for value in (float("nan"), float("inf"), True, -1):
            d = fixture(); d["segments"][0]["startSeconds"] = value
            with self.subTest(value=value), self.assertRaises(v.StudyError): v.validate_study(d)
        d = fixture(); d["segments"].append(copy.deepcopy(d["segments"][0]))
        with self.assertRaises(v.StudyError): v.validate_study(d)

    def test_malformed_container_types_fail_with_actionable_errors(self):
        for value in (None, [], True, {"schemaVersion": True}):
            with self.subTest(value=value), self.assertRaises(v.StudyError): v.validate_study(value)
        d = fixture(); d["source"]["url"] = None
        with self.assertRaises(v.StudyError): v.validate_study(d)

    def test_unresolved_route_cannot_be_exported(self):
        for change in ({"unknowns": ["unknown collision"]}, {"route": {"status": "unresolved"}}):
            d = fixture(); d["segments"][0].update(change)
            with self.assertRaises(v.StudyError): v.export_navigation(d, "test")

    def test_no_unlocked_start_no_supported_coordinates_no_export(self):
        for change in ({"startUnlocked": False}, {"coordinateSystem": "screen-pixels"},
                       {"mapLayer": "Teyvat/underground"}):
            d = fixture(); d["segments"][0]["route"].update(change)
            with self.subTest(change=change), self.assertRaises(v.StudyError): v.export_navigation(d, "test")

    def test_unsupported_actions_and_unsourced_coordinates_fail(self):
        for change in ({"action": "fake-unlock"}, {"move_mode": "swim"},
                       {"coordinateSource": ""}, {"evidenceTimeSeconds": 1}, {"x": float("nan")}):
            d = fixture(); d["segments"][0]["route"]["positions"][1].update(change)
            with self.subTest(change=change), self.assertRaises(v.StudyError): v.export_navigation(d, "test")

    def test_export_preserves_only_supported_navigation_fields(self):
        result = v.export_navigation(fixture(), "test")
        self.assertEqual(result["positions"][0], {"x": 10, "y": -20, "type": "teleport", "move_mode": "walk", "action": ""})
        self.assertIn("仅导航", result["info"]["name"])

    def test_html_cannot_be_terminated_by_imported_notes(self):
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / "review.html"
            v.render({"source": {"title": "</script><img onerror=alert(1)>"}}, fixture(), path)
            text = path.read_text()
            self.assertNotIn("</script><img", text)
            self.assertIn("\\u003c/script>", text)


class MediaTests(unittest.TestCase):
    def test_prepare_and_original_frame_clip_keep_actual_timestamps(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp); media = root / "synthetic.mp4"
            v.run(["ffmpeg", "-v", "error", "-f", "lavfi", "-i", "testsrc2=size=64x64:rate=6:duration=3",
                   "-c:v", "libx264", "-pix_fmt", "yuv420p", media])
            info = root / "metadata.json"
            v.write_json(info, {"id": "BV1XSHDzqE2h_p2", "webpage_url": fixture()["source"]["url"],
                "duration": 3, "title": "Synthetic test media", "uploader": "test"})
            out = root / "study"
            v.prepare(argparse.Namespace(media=media, out=out, info=info, interval=1, study=None))
            m = v.read_json(out / "manifest.json")
            self.assertEqual([x["timeSeconds"] for x in m["samples"]], [0, 1, 2])
            self.assertEqual(len(m["sha256"]), 64)
            self.assertFalse(m["hasAudio"])
            self.assertTrue((out / "review.html").exists())
            self.assertNotIn("formats", m)
            clipout = root / "clip"
            v.clip(argparse.Namespace(media=media, out=clipout, start=1, end=2))
            frames = v.read_json(clipout / "frames.json")["frames"]
            self.assertEqual(len(frames), 6)
            self.assertEqual(frames[0]["timeSeconds"], 1)
            self.assertAlmostEqual(frames[-1]["timeSeconds"], 1 + 5/6, places=4)
            self.assertTrue((clipout / "frames.html").exists())


if __name__ == "__main__":
    unittest.main(verbosity=2)
