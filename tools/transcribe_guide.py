#!/usr/bin/env python3
"""Transcribe local guide speech for review, keeping raw transcripts outside Git."""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess

import numpy as np


def transcribe(media, output, model_path):
    from faster_whisper import WhisperModel
    media, output = Path(media), Path(output)
    if output.exists():
        raise ValueError('Refusing to overwrite an existing transcript')
    audio = np.frombuffer(subprocess.check_output([
        'ffmpeg', '-hide_banner', '-loglevel', 'error', '-nostdin', '-i', str(media),
        '-map', '0:a:0', '-ar', '16000', '-ac', '1', '-f', 'f32le', '-'
    ]), dtype=np.float32)
    model = WhisperModel(str(model_path), device='cpu', compute_type='int8', cpu_threads=2, num_workers=1)
    segments, info = model.transcribe(audio, language='zh', beam_size=3, vad_filter=True,
        condition_on_previous_text=False,
        initial_prompt='原神。挪德卡莱、伦波岛、希汐岛、帕哈岛、空月之灵、月灵、传送锚点、新月神像、上行、下行、望月。')
    rows = [{'start': round(s.start, 3), 'end': round(s.end, 3), 'text': s.text,
             'avgLogProb': round(s.avg_logprob, 4)} for s in segments]
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps({
        'source': media.name, 'sourceSha256': hashlib.sha256(media.read_bytes()).hexdigest(),
        'model': Path(model_path).name, 'language': info.language, 'duration': len(audio)/16000,
        'notice': 'Automatic speech transcription. Proper nouns, directions and key names require visual corroboration. This is not an authored subtitle track or a claim of manual listening.',
        'segments': rows
    }, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')
    print(f'{media.name}: {len(rows)} speech segments', flush=True)


if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--media', required=True); p.add_argument('--out', required=True)
    p.add_argument('--model', required=True)
    a = p.parse_args(); transcribe(a.media, a.out, a.model)
