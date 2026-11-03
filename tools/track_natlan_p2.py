#!/usr/bin/env python3
"""Track all decoded frames of the documented Natlan 5.0 P2 layout.

Requires OpenCV + NumPy in the analysis environment. It produces observations,
never assumes a walkable route from a successful two-dimensional match.
"""
import argparse
import hashlib
import json
import math
from pathlib import Path

import cv2
import numpy as np


def track(media, alignment, output):
    cv2.setNumThreads(2)
    digest = hashlib.sha256(Path(media).read_bytes()).hexdigest()
    if digest != 'dff9f9eb1bf34e12425db2dcaaf8c99c415d3b9ea419cab2d9ff1298fe4e93bb':
        raise ValueError('Tracker is calibrated only for the documented BV1xysNe1Ec4 P2 media hash')
    tr = json.loads(Path(alignment).read_text())
    cap = cv2.VideoCapture(str(media))
    fps = cap.get(cv2.CAP_PROP_FPS)
    cap.set(cv2.CAP_PROP_POS_MSEC, tr['referenceFrameTime'] * 1000)
    ok, reference = cap.read()
    if not ok:
        raise ValueError('Cannot decode reference frame')
    cap.set(cv2.CAP_PROP_POS_FRAMES, 0)
    sift = cv2.SIFT_create(nfeatures=8000, contrastThreshold=.012)
    rk, rd = sift.detectAndCompute(cv2.cvtColor(reference, cv2.COLOR_BGR2GRAY), None)
    matcher = cv2.BFMatcher()
    mask = np.zeros((440, 440), np.uint8)
    cv2.circle(mask, (226, 219), 164, 255, -1)
    cv2.circle(mask, (226, 219), 32, 0, -1)
    mask[:65, :] = 0
    mask[:, :63] = 0
    mask[:, 390:] = 0
    mask[370:, :] = 0
    previous = features = transform = None
    last_absolute = -10000
    index = 0
    rows = []
    while True:
        ok, frame = cap.read()
        if not ok:
            break
        if frame.shape[:2] != (1080, 1920):
            raise ValueError('This documented source layout must be 1920x1080')
        gray = cv2.cvtColor(frame[:440, :440], cv2.COLOR_BGR2GRAY)
        row = {'frame': index, 'timeSeconds': round(index / fps, 6), 'status': 'unlocalized'}
        flow_ok = False
        if previous is not None and features is not None and len(features) >= 8:
            q, st, err = cv2.calcOpticalFlowPyrLK(previous, gray, features, None, winSize=(19, 19), maxLevel=3)
            good = (st[:, 0] == 1) & (err[:, 0] < 20)
            a, b = features[good], q[good]
            if len(a) >= 8:
                flow, valid = cv2.estimateAffinePartial2D(a, b, method=cv2.RANSAC, ransacReprojThreshold=1.5)
                if flow is not None:
                    scale = math.hypot(flow[0, 0], flow[1, 0])
                    angle = math.degrees(math.atan2(flow[1, 0], flow[0, 0]))
                    flow_ok = int(valid.sum()) >= 8 and .97 < scale < 1.03 and abs(angle) < 2 and np.linalg.norm(flow[:, 2]) < 40
                    if flow_ok and transform is not None:
                        transform = (np.vstack((transform, [0, 0, 1])) @ np.linalg.inv(np.vstack((flow, [0, 0, 1]))))[:2]
                    features = b[valid[:, 0] == 1] if flow_ok else None
        if not flow_ok:
            transform = None
        if index % 30 == 0 or (transform is None and index % 5 == 0):
            k, d = sift.detectAndCompute(gray, mask)
            good = [m for m, n in matcher.knnMatch(d, rd, k=2) if m.distance < .7 * n.distance] if d is not None else []
            if len(good) >= 8:
                a = np.float32([k[m.queryIdx].pt for m in good])
                b = np.float32([rk[m.trainIdx].pt for m in good])
                mat, valid = cv2.estimateAffinePartial2D(a, b, method=cv2.RANSAC, ransacReprojThreshold=2, maxIters=3000)
                if mat is not None:
                    count = int(valid.sum())
                    scale = math.hypot(mat[0, 0], mat[1, 0])
                    angle = math.degrees(math.atan2(mat[1, 0], mat[0, 0]))
                    spread = np.ptp(a[valid[:, 0] == 1], axis=0)
                    if count >= 8 and count / len(good) > .5 and .35 < scale < 1.8 and abs(angle) < 2 and min(spread) > 35:
                        transform, last_absolute = mat, index
                        row.update({'absoluteInliers': count, 'scale': round(scale, 5)})
        if transform is not None and index - last_absolute <= 60:
            pixel = transform @ np.array([226., 219., 1.])
            row.update({'status': 'absolute' if 'absoluteInliers' in row else 'flow',
                        'x': round((tr['originPixelX'] - pixel[0]) / tr['pixelsPerGameUnit'], 3),
                        'y': round((tr['originPixelY'] - pixel[1]) / tr['pixelsPerGameUnit'], 3)})
        if features is None or len(features) < 35 or index % 15 == 0:
            features = cv2.goodFeaturesToTrack(gray, maxCorners=180, qualityLevel=.008, minDistance=5, mask=mask)
        rows.append(row)
        previous = gray
        index += 1
        if index % 1800 == 0:
            print('Decoded', index, 'frames; time', round(index / fps, 1), flush=True)
    result = {'schemaVersion': 1, 'source': {'bvid': 'BV1xysNe1Ec4', 'page': 2},
              'mediaSha256': digest,
              'frameCount': index, 'fps': fps, 'completeDecode': index == int(cap.get(cv2.CAP_PROP_FRAME_COUNT)),
              'alignment': tr, 'rows': rows,
              'notice': '匹配是二维位置观测，不能单独证明高度、地形通行、机关条件或可复现的移动方式。'}
    Path(output).write_text(json.dumps(result, ensure_ascii=False), encoding='utf8')
    print('Done:', index, 'decoded;', sum('x' in r for r in rows), 'localized', flush=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--media', required=True)
    parser.add_argument('--alignment', required=True)
    parser.add_argument('--out', required=True)
    args = parser.parse_args()
    track(Path(args.media).resolve(), args.alignment, args.out)
