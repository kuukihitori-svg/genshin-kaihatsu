#!/usr/bin/env python3
"""Build the importable BetterGI package from the committed navigation evidence."""
import argparse
import json
from pathlib import Path
import zipfile

ROOT = Path(__file__).resolve().parents[1]
PACKAGE = ROOT / "bettergi" / "nod-krai-p2"


def load(path):
    return json.loads(Path(path).read_text(encoding="utf-8"))


def build(archive=None):
    data = load(ROOT / "video-study" / "nod-krai-p2.navigation.json")
    routes = PACKAGE / "routes"
    routes.mkdir(parents=True, exist_ok=True)
    for leg in data["legs"]:
        if not leg["points"]:
            raise ValueError(f"Empty leg: {leg['id']}")
        points = []
        for i, p in enumerate(leg["points"]):
            if p["origin"] not in ("sift", "source-tp", "guide-map", "continuous-flight"):
                raise ValueError("An unsourced coordinate cannot enter a route")
            point = {k: p[k] for k in ("x", "y", "move_mode")}
            point.update({"type": "target" if i == len(leg["points"])-1 else "path", "action": p.get("action", "")})
            points.append(point)
        native = {"info": {"name": leg["name"] + "（视频恢复，待实机验收）", "type": "collect", "bgi_version": "0.66.0"}, "positions": points}
        (routes / (leg["id"]+".json")).write_text(json.dumps(native, ensure_ascii=False, indent=2)+"\n", encoding="utf-8")
    (PACKAGE / "plan.json").write_text(json.dumps(data, ensure_ascii=False, indent=2)+"\n", encoding="utf-8")
    if archive:
        archive = Path(archive).resolve()
        archive.parent.mkdir(parents=True, exist_ok=True)
        with zipfile.ZipFile(archive, "w", compression=zipfile.ZIP_DEFLATED) as zipped:
            for path in sorted(PACKAGE.rglob("*")):
                if path.is_file() and not any(part in ("logs", "state.json") for part in path.relative_to(PACKAGE).parts):
                    zipped.write(path, Path("伦波岛开图P2") / path.relative_to(PACKAGE))
        print(archive)
    print(f"Built {len(data['legs'])} BetterGI route fragments")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--zip")
    build(parser.parse_args().zip)
