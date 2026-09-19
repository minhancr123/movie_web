/**
 * A/V sync for sources whose audio and video streams do not start together.
 *
 * A container mux offset (audio start_time 0.777 against video 0.000, or the
 * reverse) is not a defect: the per-stream PTS *is* how a container expresses
 * sync, and every correct player honours it. ffmpeg carries that relationship
 * through a re-encode untouched — measured below, in both directions.
 *
 * This matters because it is easy to believe the opposite. A remux that
 * "compensates" for the offset with an `adelay` filter pushes the audio late
 * by exactly the offset, on every title muxed that way, which is precisely
 * the shape of bug no stall watchdog or client-side slider can catch.
 *
 * remux-avsync.test.mjs measures the default path and never passes a delay,
 * so it cannot see such a regression; this file closes that gap.
 *
 * Method: synthesize a source whose white flash and 1 kHz tone sit at the same
 * instant (t=2.0s) while the audio stream *starts* at a different time from
 * the video, run the real buildFfmpegArgs command, then locate both markers in
 * the output with blackdetect/silencedetect. In sync means they still coincide.
 *
 * Run: node tests/remux-avsync-offset.test.mjs (needs ffmpeg + ffprobe on PATH).
 */
import { spawnSync } from 'node:child_process';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as remux from '../services/playback/remuxService.js';

const have = (bin) => spawnSync(bin, ['-version'], { stdio: 'ignore' }).status === 0;
if (!have('ffmpeg') || !have('ffprobe')) {
  console.log('skip - ffmpeg/ffprobe not on PATH');
  process.exit(0);
}

const FLASH_AT = 2.0;
// AAC encoder priming is ~23ms at 44.1kHz and rides on every re-encode, so the
// bar sits just above it. A real compensation bug is hundreds of ms.
const TOLERANCE_MS = 40;

const ff = (args, cwd) => {
  const r = spawnSync('ffmpeg', args, { encoding: 'utf8', cwd, maxBuffer: 1 << 26 });
  if (r.status !== 0) throw new Error(`ffmpeg failed: ${String(r.stderr).slice(-1200)}`);
  return `${r.stdout || ''}${r.stderr || ''}`;
};

/**
 * A correctly authored 6s source: black with a white flash at FLASH_AT, and
 * silence with a tone at the same FLASH_AT, where the audio stream begins
 * `offset` seconds away from the video stream. The tone's lead-in is shortened
 * by the offset so the two markers stay coincident in presentation time.
 */
const synth = (offset, file) => {
  // Lead-in shrinks by the offset so the tone still lands on the flash: a
  // negative offset (audio stream ahead) lengthens it instead.
  const lead = FLASH_AT - offset;
  const video =
    `color=black:s=320x240:r=24:d=${FLASH_AT}[b];color=white:s=320x240:r=24:d=0.25[w];` +
    `color=black:s=320x240:r=24:d=3.75[b2];[b][w][b2]concat=n=3:v=1:a=0`;
  const audio =
    `aevalsrc=0:d=${lead}[s1];sine=frequency=1000:duration=0.25[t];` +
    `aevalsrc=0:d=3.75[s2];[s1][t][s2]concat=n=3:v=0:a=1`;
  ff([
    '-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'lavfi', '-i', video,
    '-itsoffset', String(offset), '-f', 'lavfi', '-i', audio,
    '-map', '0:v', '-map', '1:a',
    '-c:v', 'libx264', '-preset', 'ultrafast', '-g', '48', '-c:a', 'aac',
    '-t', '6', file,
  ]);
  return file;
};

/** Flash onset and tone onset on one media timeline, in seconds. */
const markers = (target, cwd) => {
  // Those demuxer options belong to the HLS playlist only; a plain file input
  // rejects them outright.
  const hls = target.endsWith('.m3u8')
    ? ['-protocol_whitelist', 'file,crypto,data', '-allowed_extensions', 'ALL']
    : [];
  const out = ff([
    '-hide_banner', ...hls,
    '-i', target,
    '-vf', 'blackdetect=d=0.05:pix_th=0.1',
    '-af', 'silencedetect=n=-50dB:d=0.1',
    '-f', 'null', '-',
  ], cwd);
  const flash = Number((out.match(/black_end:([\d.]+)/) || [])[1]);
  const tone = Number((out.match(/silence_end: ([\d.]+)/) || [])[1]);
  assert.ok(Number.isFinite(flash), `no flash marker found in ${target}`);
  assert.ok(Number.isFinite(tone), `no tone marker found in ${target}`);
  return { flash, tone };
};

/**
 * The delay the production resolve path would apply to this source.
 *
 * Nothing should: measured, ffmpeg already preserves the offset, so any
 * per-file "compensation" is added error rather than a correction. Resolving
 * it dynamically keeps this an assertion about the shipped behaviour — if a
 * probe-driven delay helper is ever reintroduced, it is picked up here and the
 * sync assertions below fail with the damage it causes.
 */
const productionDelayFor = (probe) =>
  typeof remux.audioDelayMsForProbe === 'function' ? remux.audioDelayMsForProbe(probe) : 0;

const cases = [
  { offset: 0.777, label: 'audio stream starts 777ms after video' },
  { offset: -0.5, label: 'audio stream starts 500ms before video' },
];

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'avsync-offset-'));
try {
  for (const { offset, label } of cases) {
    const src = synth(offset, path.join(tmp, `src_${offset}.mkv`));

    // The source itself must be sound, or the measurement means nothing.
    const before = markers(src, tmp);
    assert.ok(
      Math.abs(before.tone - before.flash) * 1000 <= TOLERANCE_MS,
      `fixture is not aligned: flash=${before.flash}s tone=${before.tone}s`,
    );

    const probe = {
      video: { startTime: Math.max(0, -offset) },
      audio: [{ startTime: Math.max(0, offset) }],
    };
    const outDir = fs.mkdtempSync(path.join(tmp, 'out-'));
    ff(
      remux.buildFfmpegArgs({
        inputUrl: src,
        outputDir: outDir,
        audioCopy: false,
        audioStreamIndex: null,
        audioChannels: null,
        audioDelayMs: productionDelayFor(probe),
        video: { mode: 'remux' },
        encoder: null,
      }),
      // startRemuxSession's cwd contract: ffmpeg resolves the bare
      // -hls_fmp4_init_filename against the process cwd, not the playlist dir.
      outDir,
    );

    const after = markers('index.m3u8', outDir);
    const driftMs = Math.round((after.tone - after.flash) * 1000);
    console.log(
      `${label}: flash=${after.flash.toFixed(3)}s tone=${after.tone.toFixed(3)}s ` +
        `drift=${driftMs > 0 ? '+' : ''}${driftMs}ms`,
    );
    assert.ok(
      Math.abs(driftMs) <= TOLERANCE_MS,
      `remux baked in ${driftMs}ms of A/V error for a source whose ${label}; ` +
        'the container offset must be carried through, not compensated for',
    );
  }
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log('ok - container mux offsets survive the remux in sync, both directions');

/* --------------------------------------------------- seek-started sessions */

/**
 * A seek-started session must be as in sync as a from-the-start one.
 *
 * Input seeking trims the *re-encoded* audio to the exact -ss point while the
 * *copied* video can only start at the keyframe before it. ffmpeg rebases the
 * two by different amounts and the audio lands ~140ms ahead of the picture —
 * audio leading is the direction viewers notice first, and it reproduces on
 * every resume, which is the common way into this path.
 *
 * remux-avsync.test.mjs already covers a seek session but measures the first
 * packet PTS of each stream, which only sees segment bookkeeping (and a normal
 * ~200ms interleave); the error lives in where the *content* lands, so it takes
 * markers to see it.
 */
const seekTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'avsync-seek-'));
try {
  // 10s pattern (flash + tone together at t=4.9), looped to 60s, then encoded
  // with B-frames and a 10s GOP so the seek has a keyframe to snap back to.
  const pattern = path.join(seekTmp, 'pattern.mkv');
  ff([
    '-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'lavfi', '-i',
    'color=black:s=320x180:r=24:d=4.9[b];color=white:s=320x180:r=24:d=0.2[w];' +
      'color=black:s=320x180:r=24:d=4.9[b2];[b][w][b2]concat=n=3:v=1:a=0',
    '-f', 'lavfi', '-i',
    'aevalsrc=0:d=4.9:s=48000[s1];sine=frequency=1000:duration=0.2:sample_rate=48000[t];' +
      'aevalsrc=0:d=4.9:s=48000[s2];[s1][t][s2]concat=n=3:v=0:a=1',
    '-map', '0:v', '-map', '1:a', '-c:v', 'libx264', '-preset', 'ultrafast',
    '-c:a', 'pcm_s16le', '-t', '10', pattern,
  ]);
  const src = path.join(seekTmp, 'seek-src.mkv');
  ff([
    '-hide_banner', '-loglevel', 'error', '-y', '-stream_loop', '5', '-i', pattern,
    // HEVC, not H.264: the trimming mismatch only shows on the hevc copy path,
    // which is what a 1080p WEB-DL release actually takes through here.
    '-c:v', 'libx265', '-preset', 'veryfast',
    '-x265-params', 'bframes=4:keyint=240:min-keyint=240', '-tag:v', 'hvc1',
    '-c:a', 'eac3', '-b:a', '640k', '-ac', '6', '-t', '60', src,
  ]);

  // 240-frame GOP at 24fps puts keyframes on every 10s. The mismatch only
  // fires when the seek lands exactly ON one (20), because there ffmpeg starts
  // the copied video at that keyframe's DTS — a B-frame reorder delay before
  // its PTS — while the re-encoded audio is cut at the PTS. Off-keyframe seeks
  // (15) decode through the pre-roll and stay aligned, so both are covered:
  // one to catch the bug, one to prove the cure does not break the good case.
  for (const startAt of [0, 15, 20]) {
    const outDir = fs.mkdtempSync(path.join(seekTmp, 'out-'));
    ff(
      remux.buildFfmpegArgs({
        inputUrl: src,
        outputDir: outDir,
        audioCopy: false,
        audioStreamIndex: null,
        audioChannels: 6,
        audioDelayMs: 0,
        video: { mode: 'remux', codec: 'hevc', ...(startAt > 0 ? { startAt } : {}) },
        encoder: null,
      }),
      outDir,
    );

    // Every marker, paired nearest-first: a seek drops leading markers, so
    // pairing by index would measure which ones survived, not their sync.
    const out = ff([
      '-hide_banner', '-protocol_whitelist', 'file,crypto,data', '-allowed_extensions', 'ALL',
      '-i', 'index.m3u8', '-vf', 'blackdetect=d=0.05:pix_th=0.1',
      '-af', 'silencedetect=n=-50dB:d=0.1', '-f', 'null', '-',
    ], outDir);
    const flashes = [...out.matchAll(/black_end:([\d.]+)/g)].map((m) => Number(m[1]));
    const tones = [...out.matchAll(/silence_end: ([\d.]+)/g)].map((m) => Number(m[1]));
    const drifts = tones
      .map((t) => {
        let near = null;
        for (const f of flashes) if (near === null || Math.abs(t - f) < Math.abs(t - near)) near = f;
        return near === null ? NaN : Math.round((t - near) * 1000);
      })
      .filter((v) => Number.isFinite(v) && Math.abs(v) < 3000);

    assert.ok(drifts.length >= 3, `not enough markers to judge startAt=${startAt}`);
    // Median, not worst: a real desync moves every marker together, while the
    // last one sits on the end of the stream where the detectors clip.
    const median = [...drifts].sort((a, b) => a - b)[Math.floor(drifts.length / 2)];
    console.log(`startAt=${startAt}: ${drifts.length} markers, drift ms = [${drifts.join(', ')}], median ${median}ms`);
    assert.ok(
      Math.abs(median) <= TOLERANCE_MS,
      `seek-started remux (startAt=${startAt}) put the audio ${median}ms from the picture; ` +
        'input seeking must not trim audio and video to different points',
    );
  }
} finally {
  fs.rmSync(seekTmp, { recursive: true, force: true });
}

console.log('ok - seek-started remux keeps audio on the picture');
