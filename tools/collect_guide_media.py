#!/usr/bin/env python3
"""Download public guide media for local analysis; keep signed metadata out of Git."""
import argparse
import concurrent.futures
import hashlib
import json
from pathlib import Path
import re
import subprocess
import time
import urllib.request


def ranged_download(url, headers, destination, workers=6, chunk_size=1024*1024):
    """Validate every byte range before assembling independently resumable chunks."""
    destination = Path(destination)
    request = urllib.request.Request(url, headers={**headers, 'Range': 'bytes=0-0'})
    with urllib.request.urlopen(request, timeout=30) as response:
        match = re.fullmatch(r'bytes 0-0/(\d+)', response.headers.get('Content-Range', ''))
        if response.status != 206 or not match or len(response.read()) != 1:
            raise ValueError('Server did not honor a one-byte range request')
        total = int(match[1])
    if destination.exists() and destination.stat().st_size == total:
        return total
    parts = destination.with_suffix(destination.suffix+'.parts')
    parts.mkdir(parents=True, exist_ok=True)

    def get(index):
        start, end = index*chunk_size, min(total, (index+1)*chunk_size)-1
        part = parts / f'{index:06d}'
        if part.exists() and part.stat().st_size == end-start+1:
            return
        req = urllib.request.Request(url, headers={**headers, 'Range': f'bytes={start}-{end}'})
        for attempt in range(3):
            try:
                with urllib.request.urlopen(req, timeout=35) as response:
                    if response.status != 206 or response.headers.get('Content-Range') != f'bytes {start}-{end}/{total}':
                        raise ValueError('Server returned an unexpected range')
                    data = response.read(end-start+2)
                if len(data) != end-start+1:
                    raise ValueError('Incomplete or oversized range response')
                part.write_bytes(data)
                return
            except Exception:
                if attempt == 2:
                    raise
                time.sleep(.5)

    count = (total+chunk_size-1)//chunk_size
    with concurrent.futures.ThreadPoolExecutor(max_workers=workers) as pool:
        for done, _ in enumerate(pool.map(get, range(count)), 1):
            if done % 20 == 0 or done == count:
                print(f'{destination.name}: {done}/{count} ranges', flush=True)
    temporary = destination.with_suffix(destination.suffix+'.assembling')
    with temporary.open('wb') as output:
        for index in range(count):
            output.write((parts / f'{index:06d}').read_bytes())
    if temporary.stat().st_size != total:
        raise ValueError('Assembled size does not match source size')
    temporary.replace(destination)
    return total


def collect(info_path, destination, workers=6):
    info_path, destination = Path(info_path), Path(destination)
    info = json.loads(info_path.read_text(encoding='utf-8'))
    identity = info['id']
    if not re.fullmatch(r'BV[A-Za-z0-9]{10}(?:_p\d+)?', identity):
        raise ValueError('Expected a Bilibili video or part identity')
    destination.mkdir(parents=True, exist_ok=True)
    output = destination / f'{identity}.mp4'
    if output.exists():
        print(f'Already downloaded: {output}', flush=True)
        return output
    formats = info['formats']
    # Prefer public 1080p AV1 for a smaller file without reducing map resolution.
    videos = [f for f in formats if f.get('height') == 1080 and f.get('vcodec') != 'none']
    videos.sort(key=lambda f: (0 if f['format_id']=='100026' else 1 if f['format_id']=='30080' else 2))
    audios = [f for f in formats if f.get('vcodec')=='none' and f.get('acodec')!='none']
    audios.sort(key=lambda f: f.get('abr') or 1e9)
    if not videos or not audios:
        raise ValueError('Public 1080p video and audio formats are required')
    chosen = []
    for choices, kind in [(videos, 'video'), (audios, 'audio')]:
        failure = None
        for fmt in choices:
            path = destination / f'{identity}.{fmt["format_id"]}.m4s'
            headers = {**info.get('http_headers', {}), **fmt.get('http_headers', {}), 'Referer':'https://www.bilibili.com/'}
            try:
                ranged_download(fmt['url'], headers, path, workers)
                chosen.append(path)
                break
            except Exception as error:
                failure = error
                print(f'{identity}: {kind} format {fmt["format_id"]} unavailable ({type(error).__name__})', flush=True)
        else:
            raise ValueError(f'Public {kind} download failed: {type(failure).__name__}')
    subprocess.run(['ffmpeg','-hide_banner','-loglevel','error','-nostdin','-y','-i',str(chosen[0]),'-i',str(chosen[1]),'-map','0:v:0','-map','1:a:0','-c','copy',str(output)], check=True)
    digest = hashlib.sha256(output.read_bytes()).hexdigest()
    metadata = {key:info.get(key) for key in ['id','title','uploader','duration','webpage_url']}
    metadata.update({'sha256':digest,'selectedFormats':[p.name for p in chosen]})
    (destination / f'{identity}.source.json').write_text(json.dumps(metadata,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    print(f'Finished: {output}', flush=True)
    return output


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--info', required=True)
    parser.add_argument('--out', required=True)
    parser.add_argument('--workers', type=int, default=6)
    arguments = parser.parse_args()
    collect(arguments.info, arguments.out, max(1,min(8,arguments.workers)))
