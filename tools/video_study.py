#!/usr/bin/env python3
"""Local, evidence-first Bilibili study tools. Media stays outside the repository."""
import argparse
import hashlib
import json
import math
import os
from pathlib import Path
import re
import subprocess
import sys
from urllib.parse import parse_qs, urlparse

ROOT = Path(__file__).resolve().parents[1]


class StudyError(ValueError):
    pass


def read_json(path):
    return json.loads(Path(path).read_text(encoding="utf-8"))


def write_json(path, data):
    Path(path).write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def run(args):
    result = subprocess.run([str(x) for x in args], capture_output=True, text=True)
    if result.returncode:
        raise StudyError(f"{args[0]} failed: {result.stderr[-3000:]}")
    return result.stdout, result.stderr


def number(value, label, minimum=0):
    if type(value) not in (int, float) or not math.isfinite(value) or value < minimum:
        raise StudyError(f"{label}: expected finite number >= {minimum}")
    return value


def parse_source(url):
    if not isinstance(url, str):
        raise StudyError("Video URL must be a string")
    parsed = urlparse(url)
    match = re.fullmatch(r"/video/(BV[A-Za-z0-9]{10})/?", parsed.path)
    if parsed.scheme != "https" or parsed.netloc != "www.bilibili.com" or not match:
        raise StudyError("Use an https://www.bilibili.com/video/BV…/ URL")
    pages = parse_qs(parsed.query).get("p", ["1"])
    if len(pages) != 1 or not pages[0].isdigit() or int(pages[0]) < 1:
        raise StudyError("p must be a positive integer")
    page = int(pages[0])
    return {"bvid": match[1], "page": page,
            "url": f"https://www.bilibili.com/video/{match[1]}/?p={page}"}


def sha256(path):
    digest = hashlib.sha256()
    with Path(path).open("rb") as file:
        for chunk in iter(lambda: file.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def project_tp(position):
    """BetterGI 0.66.0 GiWorldPosition: route X=Position[2], Y=Position[0]."""
    if not isinstance(position, list) or len(position) != 3:
        raise StudyError("Expected source world position [vertical, height, horizontal]")
    for value in position:
        number(value, "worldPosition", -1e7)
    return {"x": position[2], "y": position[0], "height": position[1]}


def align_map(data):
    if not isinstance(data, dict):
        raise StudyError("Map anchors must be an object")
    if data.get("orientation") != "north-up" or data.get("mapLayer") != "Teyvat/surface":
        raise StudyError("Only a fixed north-up Teyvat surface map can be aligned")
    points = data.get("points", [])
    if not isinstance(points, list):
        raise StudyError("points must be an array")
    rows = []
    for p in points:
        if not isinstance(p, dict) or not isinstance(p.get("pixel"), dict):
            raise StudyError("Each map point needs worldPosition and pixel coordinates")
        world = project_tp(p["worldPosition"])
        px, py = number(p["pixel"]["x"], "pixel.x"), number(p["pixel"]["y"], "pixel.y")
        rows.append((world["x"], world["y"], px, py))
    control = [r for p, r in zip(points, rows) if p.get("control") is True]
    if len(control) < 3:
        raise StudyError("At least three non-collinear control points are required")
    means = [sum(p[i] for p in control) / len(control) for i in range(4)]
    varx = sum((p[0] - means[0])**2 for p in control)
    vary = sum((p[1] - means[1])**2 for p in control)
    cov = sum((p[0] - means[0])*(p[1] - means[1]) for p in control)
    if varx * vary - cov**2 <= 1e-9:
        raise StudyError("Collinear control points cannot establish a map alignment")
    scale = -sum((p[0]-means[0])*(p[2]-means[2]) + (p[1]-means[1])*(p[3]-means[3]) for p in control) / (varx+vary)
    if scale <= 0:
        raise StudyError("Control points contradict north-up axes")
    ox, oy = means[2]+scale*means[0], means[3]+scale*means[1]
    aligned = []
    for p, r in zip(points, rows):
        error = math.hypot(ox-scale*r[0]-r[2], oy-scale*r[1]-r[3])
        aligned.append({**p, "pathing": project_tp(p["worldPosition"]), "residualPixels": round(error, 4)})
    limit = number(data.get("maxResidualPixels", 12), "maxResidualPixels", 0.1)
    maximum = max(p["residualPixels"] for p in aligned)
    if maximum > limit:
        raise StudyError(f"Map alignment residual {maximum}px exceeds {limit}px")
    return {"schemaVersion": 1, "source": data["source"], "reference": data["reference"],
        "frame": data["frame"], "coordinateSystem": "bettergi-pathing-v1", "mapLayer": data["mapLayer"],
        "status": "targets_aligned_only", "notice": "目标对应关系已按地图核对；不包含中间可走路线、碰撞和交互验证。",
        "transform": {"pixelsPerGameUnit": scale, "originPixelX": ox, "originPixelY": oy,
                      "formula": "pixelX=originPixelX-scale*pathingX; pixelY=originPixelY-scale*pathingY"},
        "maxResidualPixels": maximum, "points": aligned}


def probe(media):
    data = json.loads(run(["ffprobe", "-v", "error", "-show_format", "-show_streams", "-of", "json", media])[0])
    video = next((s for s in data["streams"] if s["codec_type"] == "video"), None)
    if not video:
        raise StudyError("No video stream")
    rate = video["r_frame_rate"].split("/")
    return {"durationSeconds": float(data["format"]["duration"]), "width": video["width"],
            "height": video["height"], "frameRate": int(rate[0]) / int(rate[1]),
            "hasAudio": any(s["codec_type"] == "audio" for s in data["streams"])}


def fetch(args):
    source = parse_source(args.url)
    out = Path(args.out).resolve()
    out.mkdir(parents=True, exist_ok=True)
    stem = f"{source['bvid']}_p{source['page']}"
    command = [sys.executable, "-m", "yt_dlp", "--no-playlist", "--socket-timeout", "25",
               "--retries", "2", "--http-chunk-size", "4M", "--user-agent", "Mozilla/5.0",
               "--referer", "https://www.bilibili.com/", "--write-info-json", "--merge-output-format", "mp4",
               "-f", "bestvideo[height<=1080][vcodec^=avc1]+bestaudio[ext=m4a]/best[height<=1080]",
               "-o", str(out / (stem + ".%(ext)s"))]
    if args.cookies:
        command += ["--cookies", str(Path(args.cookies).resolve())]
    # yt-dlp handles signed CDN URLs internally; don't copy its raw info JSON into Git.
    result = subprocess.run(command + [source["url"]])
    if result.returncode:
        raise StudyError("Download failed; preserve partial files for resuming")
    print(out / (stem + ".mp4"))


def extract_frames(media, out, interval):
    out.mkdir(parents=True, exist_ok=True)
    if any(out.iterdir()):
        raise StudyError(f"Frame directory must be empty: {out}")
    # select + showinfo keeps actual presentation timestamps, not guessed sample times.
    selection = f"isnan(prev_selected_t)+gte(t-prev_selected_t,{interval})"
    filters = f"select='{selection}',scale=1280:-2,showinfo"
    command = ["ffmpeg", "-hide_banner", "-nostdin", "-i", media]
    command += ["-vf", filters, "-fps_mode", "vfr", "-q:v", "3", out / "%05d.jpg"]
    _, log = run(command)
    times = [float(x) for x in re.findall(r"\bn:\s*\d+.*?\bpts_time:([\d.eE+-]+)", log)]
    paths = sorted(out.glob("*.jpg"))
    if len(times) != len(paths):
        raise StudyError(f"Frame/PTS count mismatch: {len(paths)} vs {len(times)}")
    return [{"timeSeconds": t, "file": str(p.name)} for t, p in zip(times, paths)]


def contact_sheets(samples, root):
    from PIL import Image, ImageDraw
    sheets = []
    for offset in range(0, len(samples), 20):
        sheet = Image.new("RGB", (1920, 1500), "#101725")
        draw = ImageDraw.Draw(sheet)
        for index, sample in enumerate(samples[offset:offset + 20]):
            x, y = index % 4 * 480, index // 4 * 300
            with Image.open(root / sample["file"]) as frame:
                frame.thumbnail((480, 270))
                sheet.paste(frame, (x, y))
            seconds = sample["timeSeconds"]
            draw.text((x + 10, y + 276), f"{int(seconds//60):02}:{seconds%60:06.3f}  |  {sample['file']}", fill="white")
        name = f"sheet-{len(sheets)+1:02}.jpg"
        sheet.save(root.parent / name, quality=90)
        sheets.append(name)
    return sheets


def render(manifest, study, output):
    template = (ROOT / "video-study" / "review.html").read_text(encoding="utf-8")
    # Escape '<' so imported notes cannot terminate the inert JSON script element.
    payload = json.dumps({"manifest": manifest, "study": study}, ensure_ascii=False).replace("<", "\\u003c")
    Path(output).write_text(template.replace("__STUDY_DATA__", payload), encoding="utf-8")


def render_clip(data, output):
    template = (ROOT / "video-study" / "frames.html").read_text(encoding="utf-8")
    payload = json.dumps(data, ensure_ascii=False).replace("<", "\\u003c")
    Path(output).write_text(template.replace("__FRAME_DATA__", payload), encoding="utf-8")


def prepare(args):
    media, out = Path(args.media).resolve(), Path(args.out).resolve()
    out.mkdir(parents=True, exist_ok=True)
    info = read_json(args.info)
    source = parse_source(info["webpage_url"])
    expected_id = f"{source['bvid']}_p{source['page']}"
    if info.get("id") != expected_id:
        raise StudyError(f"Part mismatch: expected {expected_id}, got {info.get('id')}")
    stats = probe(media)
    if abs(stats["durationSeconds"] - info["duration"]) > 1:
        raise StudyError("Media duration differs from source metadata by >1 second")
    source.update({"title": info["title"], "creator": info.get("uploader"), "id": expected_id})
    interval = number(args.interval, "interval", 0.1)
    samples = extract_frames(media, out / "frames", interval)
    sheets = contact_sheets(samples, out / "frames")
    for sample in samples:
        sample["file"] = "frames/" + sample["file"]
    manifest = {"schemaVersion": 1, "source": source, "media": os.path.relpath(media, out),
                "sha256": sha256(media), **stats, "sampleIntervalSeconds": interval,
                "samples": samples, "sheets": sheets,
                "subtitleStatus": "not_acquired", "reviewStatus": "sampling_only"}
    write_json(out / "manifest.json", manifest)
    study = read_json(args.study) if args.study else {"schemaVersion": 1, "source": source,
                "durationSeconds": stats["durationSeconds"], "segments": []}
    validate_study(study, manifest)
    render(manifest, study, out / "review.html")
    print(f"Prepared {len(samples)} timestamped samples; {out / 'review.html'}")


def validate_study(study, manifest=None):
    if not isinstance(study, dict) or type(study.get("schemaVersion")) is not int or study.get("schemaVersion") != 1:
        raise StudyError("Unsupported study schemaVersion")
    source = study.get("source", {})
    if not isinstance(source, dict) or type(source.get("page")) is not int:
        raise StudyError("source with integer page is required")
    canonical = parse_source(source.get("url", ""))
    if any(source.get(k) != canonical[k] for k in ("bvid", "page")):
        raise StudyError("Study source does not match its URL")
    duration = number(study.get("durationSeconds"), "durationSeconds", 0.1)
    if manifest:
        if any(manifest["source"][k] != source[k] for k in ("bvid", "page")):
            raise StudyError("Study and media refer to different video/part")
        if abs(duration - manifest["durationSeconds"]) > 1:
            raise StudyError("Study and media duration mismatch")
    if not isinstance(study.get("segments"), list):
        raise StudyError("segments must be an array")
    ids = set()
    last_start = -1
    for segment in study["segments"]:
        if not isinstance(segment, dict):
            raise StudyError("Each segment must be an object")
        sid = segment.get("id")
        if not isinstance(sid, str) or not re.fullmatch(r"[a-zA-Z0-9_-]+", sid) or sid in ids:
            raise StudyError("Segment IDs must be unique safe names")
        ids.add(sid)
        start = number(segment.get("startSeconds"), f"{sid}.startSeconds")
        end = number(segment.get("endSeconds"), f"{sid}.endSeconds")
        if end <= start or end > duration + 0.05 or start < last_start:
            raise StudyError(f"{sid}: invalid or unordered time range")
        last_start = start
        for key in ("title", "observation"):
            if not isinstance(segment.get(key), str) or not segment[key].strip():
                raise StudyError(f"{sid}: {key} is required")
        unknowns = segment.get("unknowns")
        if not isinstance(unknowns, list) or any(not isinstance(x, str) or not x.strip() for x in unknowns):
            raise StudyError(f"{sid}: unknowns must be an array of strings")
        evidence = segment.get("evidence")
        if not isinstance(evidence, list) or not evidence:
            raise StudyError(f"{sid}: timestamped evidence is required")
        for item in evidence:
            if not isinstance(item, dict):
                raise StudyError(f"{sid}: each evidence must be an object")
            t = number(item.get("timeSeconds"), f"{sid}.evidence.timeSeconds")
            if not start <= t <= end or not isinstance(item.get("description"), str) or not item["description"].strip():
                raise StudyError(f"{sid}: invalid evidence")
    return study


def export_navigation(study, segment_id):
    validate_study(study)
    segment = next((x for x in study["segments"] if x["id"] == segment_id), None)
    if not segment:
        raise StudyError("Unknown segment")
    route = segment.get("route", {})
    if not isinstance(route, dict):
        raise StudyError("route must be an object")
    if segment["unknowns"] or route.get("status") != "reviewed":
        raise StudyError("Unresolved evidence/route; refusing to invent an executable path")
    if route.get("coordinateSystem") != "bettergi-pathing-v1" or route.get("mapLayer") != "Teyvat/surface":
        raise StudyError("Only explicitly aligned BetterGI Teyvat surface coordinates are supported")
    if route.get("startUnlocked") is not True:
        raise StudyError("The starting teleport must already be unlocked")
    positions = route.get("positions", [])
    if not isinstance(positions, list) or any(not isinstance(p, dict) for p in positions):
        raise StudyError("positions must be an array of objects")
    if len(positions) < 2 or positions[0].get("type") != "teleport" or positions[-1].get("type") != "target":
        raise StudyError("Route requires teleport start and target end")
    output = []
    evidence_times = {e["timeSeconds"] for e in segment["evidence"]}
    for index, p in enumerate(positions):
        if p.get("type") not in (("teleport",) if index == 0 else ("path", "target")):
            raise StudyError("Unsupported path point type")
        if p.get("move_mode") not in ("walk", "run", "dash", "fly", "climb") or p.get("action", "") != "":
            raise StudyError("Unsupported movement/action")
        if p.get("evidenceTimeSeconds") not in evidence_times or not isinstance(p.get("coordinateSource"), str) or not p["coordinateSource"].strip():
            raise StudyError("Every coordinate needs a source and timestamped evidence")
        for axis in ("x", "y"):
            number(p.get(axis), f"position.{axis}", -1e7)
        output.append({k: p[k] for k in ("x", "y", "type", "move_mode")} | {"action": ""})
    return {"info": {"name": segment["title"] + "（仅导航，待实机验收）", "type": "collect"}, "positions": output}


def clip(args):
    media, out = Path(args.media).resolve(), Path(args.out).resolve()
    stats = probe(media)
    start, end = number(args.start, "start"), number(args.end, "end")
    if end <= start or end > stats["durationSeconds"] or end - start > 15:
        raise StudyError("Choose a valid clip of at most 15 seconds")
    out.mkdir(parents=True, exist_ok=True)
    if any(out.iterdir()):
        raise StudyError("Clip output must be empty")
    filters = f"trim=start=0:end={end-start},showinfo"
    _, log = run(["ffmpeg", "-hide_banner", "-nostdin", "-ss", str(start), "-t", str(end-start),
                  "-i", media, "-vf", filters,
                  "-fps_mode", "vfr", "-q:v", "2", out / "%05d.jpg"])
    times = [round(start + float(x), 6) for x in re.findall(r"\bn:\s*\d+.*?\bpts_time:([\d.eE+-]+)", log)]
    frames = sorted(out.glob("*.jpg"))
    if len(times) != len(frames) or not times:
        raise StudyError("Could not align original frame timestamps")
    data = {"sourceSha256": sha256(media), "startSeconds": start,
        "endSeconds": end, "frameRate": stats["frameRate"], "frames": [
            {"timeSeconds": t, "file": p.name} for t, p in zip(times, frames)]}
    write_json(out / "frames.json", data)
    render_clip(data, out / "frames.html")
    print(f"Extracted {len(frames)} original frames ({times[0]}–{times[-1]}s)")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    p = sub.add_parser("fetch", help="Download one Bilibili part with yt-dlp")
    p.add_argument("url"); p.add_argument("--out", required=True); p.add_argument("--cookies")
    p.set_defaults(func=fetch)
    p = sub.add_parser("prepare", help="Probe, sample, hash and make a local review page")
    p.add_argument("--media", required=True); p.add_argument("--info", required=True)
    p.add_argument("--out", required=True); p.add_argument("--interval", type=float, default=5)
    p.add_argument("--study"); p.set_defaults(func=prepare)
    p = sub.add_parser("clip", help="Extract <=15s at original frame rate with original PTS")
    p.add_argument("--media", required=True); p.add_argument("--out", required=True)
    p.add_argument("--start", type=float, required=True); p.add_argument("--end", type=float, required=True)
    p.set_defaults(func=clip)
    p = sub.add_parser("review", help="Validate annotations and rebuild local review page")
    p.add_argument("--manifest", required=True); p.add_argument("--study", required=True)
    p.set_defaults(func=lambda a: review(a))
    p = sub.add_parser("export", help="Export a reviewed, aligned navigation segment")
    p.add_argument("--study", required=True); p.add_argument("--segment", required=True)
    p.add_argument("--out", required=True)
    p.set_defaults(func=lambda a: write_json(a.out, export_navigation(read_json(a.study), a.segment)))
    p = sub.add_parser("align-map", help="Align fixed map pixels to sourced teleport targets")
    p.add_argument("--anchors", required=True); p.add_argument("--out", required=True)
    p.set_defaults(func=lambda a: write_json(a.out, align_map(read_json(a.anchors))))
    args = parser.parse_args()
    try:
        args.func(args)
    except (StudyError, OSError, KeyError, TypeError, json.JSONDecodeError) as error:
        print(f"ERROR: {error}", file=sys.stderr)
        return 1
    return 0


def review(args):
    manifest, study = read_json(args.manifest), read_json(args.study)
    validate_study(study, manifest)
    output = Path(args.manifest).resolve().parent / "review.html"
    render(manifest, study, output)
    print(output)


if __name__ == "__main__":
    sys.exit(main())
