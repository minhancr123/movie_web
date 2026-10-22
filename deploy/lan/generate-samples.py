#!/usr/bin/env python3
"""Generate only synthetic media; no provider accounts or third-party films."""
import argparse
from pathlib import Path
import subprocess


def run(args):
    subprocess.run(args, check=True, stdin=subprocess.DEVNULL)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('output', type=Path)
    parser.add_argument('--gpu', action='store_true')
    args = parser.parse_args()
    root = args.output.resolve()
    root.mkdir(parents=True, exist_ok=True)
    cues = ['WEBVTT', '']
    for at in range(0, 120, 5):
        start = f'00:{at // 60:02d}:{at % 60:02d}.000'
        end = f'00:{(at + 4) // 60:02d}:{(at + 4) % 60:02d}.000'
        cues += [f'{start} --> {end}', f'Phụ đề mẫu — mốc {at // 60:02d}:{at % 60:02d}', '']
    (root / 'vi.vtt').write_text('\n'.join(cues), encoding='utf-8')
    fullhd = root / 'fullhd.mp4'
    if not fullhd.exists():
        run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-nostdin',
             '-f', 'lavfi', '-i', 'testsrc2=size=1920x1080:rate=24',
             '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000',
             '-t', '120', '-vf', "drawtext=text='CineVN SAMPLE %{pts\\:hms}':fontsize=48:fontcolor=white:box=1:boxcolor=black@0.7:x=40:y=40",
             '-c:v', 'h264_nvenc' if args.gpu else 'libx264',
             '-preset', 'p4' if args.gpu else 'ultrafast', '-threads', '2',
             '-b:v', '8M', '-maxrate', '10M', '-bufsize', '16M', '-g', '96',
             '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '128k',
             '-movflags', '+faststart', str(fullhd)])
    # AC3 in MKV deliberately needs CineVN's audio conversion/container path.
    mkv = root / 'remux-source.mkv'
    if not mkv.exists():
        run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-nostdin',
             '-i', str(fullhd), '-i', str(root / 'vi.vtt'),
             '-map', '0:v:0', '-map', '0:a:0', '-map', '1:0',
             '-c:v', 'copy', '-c:a', 'ac3', '-b:a', '192k',
             '-c:s', 'srt', '-metadata:s:s:0', 'language=vie', str(mkv)])
    if args.gpu and not (root / '4k.mp4').exists():
        run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-nostdin',
             '-f', 'lavfi', '-i', 'testsrc2=size=3840x2160:rate=24',
             '-f', 'lavfi', '-i', 'sine=frequency=660:sample_rate=48000',
             '-t', '40', '-c:v', 'hevc_nvenc', '-preset', 'p4', '-threads', '2',
             '-b:v', '16M', '-maxrate', '20M', '-bufsize', '32M', '-g', '96',
             '-pix_fmt', 'yuv420p', '-tag:v', 'hvc1', '-c:a', 'aac',
             '-b:a', '128k', '-movflags', '+faststart', str(root / '4k.mp4')])
    print(f'Synthetic samples ready: {root}')


if __name__ == '__main__':
    main()
