import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = path.resolve(import.meta.dirname, '..');
const outDir = mkdtempSync(path.join(tmpdir(), 'playback-progress-'));

execFileSync(
    process.execPath,
    [path.join(root, 'node_modules', 'typescript', 'bin', 'tsc'), 'src/lib/playback-progress.ts',
        '--outDir', outDir, '--module', 'commonjs', '--target', 'es2020',
        '--moduleResolution', 'node', '--skipLibCheck'],
    { cwd: root, stdio: 'pipe' },
);

const { computeResumeAt, clampSeekToHead, pickDisplayDuration, decideSeekTarget, planResume, shouldAutoplayAfterRebuild, shouldDowngradeForDropped, audioSwitchStartAt, subtitleLookupTime } = await import(
    pathToFileURL(path.join(outDir, 'playback-progress.js')).href
);
process.on('exit', () => rmSync(outDir, { recursive: true, force: true }));

test('computeResumeAt backs off 2s and clamps to duration', () => {
    assert.equal(computeResumeAt(302, 3600), 300);
    assert.equal(computeResumeAt(3599.5, 3600), 3595, 'never lands past duration - 5');
    assert.equal(computeResumeAt(10, 0), 8, 'unknown duration still resumes');
    assert.equal(computeResumeAt(0.5, 3600), null, 'near-zero progress starts at 0');
    assert.equal(computeResumeAt(undefined, 3600), null);
    assert.equal(computeResumeAt(NaN, 3600), null);
});

test('clampSeekToHead only intervenes past the written head', () => {
    assert.deepEqual(clampSeekToHead(1800, 3600), { time: 1800, clamped: false });
    const clamped = clampSeekToHead(3599, 3600);
    assert.equal(clamped.clamped, true);
    assert.equal(clamped.time, 3595);
    assert.deepEqual(
        clampSeekToHead(1800, NaN),
        { time: 1800, clamped: false },
        'unknown head passes through (native mp4, completed VOD)',
    );
    assert.deepEqual(clampSeekToHead(NaN, 3600), { time: 0, clamped: true });
});

test('pickDisplayDuration never surfaces Infinity to the seek bar', () => {
    assert.equal(pickDisplayDuration(5984, null), 5984, 'real duration wins');
    assert.equal(pickDisplayDuration(Infinity, 6000), 6000, 'live playlist falls back to estimate');
    assert.equal(pickDisplayDuration(NaN, 6000), 6000);
    assert.equal(pickDisplayDuration(Infinity, null), 0, 'nothing known -> slider fallback max');
});

test('decideSeekTarget plays inside the window, re-resolves outside it', () => {
    // Full session, target inside the written head: instant local seek.
    assert.deepEqual(
        decideSeekTarget({ target: 600, startAt: 0, headLocal: 3600, canReresolve: true }),
        { kind: 'direct', localTime: 600, clamped: false },
    );
    // Target past the head: ask the server for a session starting there.
    assert.deepEqual(
        decideSeekTarget({ target: 5000, startAt: 0, headLocal: 3600, canReresolve: true }),
        { kind: 'reresolve', at: 5000 },
    );
    // Seek-back before this session's offset: re-resolve from the target.
    assert.deepEqual(
        decideSeekTarget({ target: 100, startAt: 1800, headLocal: 1200, canReresolve: true }),
        { kind: 'reresolve', at: 100 },
    );
    // Inside a seek-started window: local time is display minus offset.
    assert.deepEqual(
        decideSeekTarget({ target: 2000, startAt: 1800, headLocal: 1200, canReresolve: true }),
        { kind: 'direct', localTime: 200, clamped: false },
    );
    // No re-resolve available (direct file): clamp, never strand.
    assert.deepEqual(
        decideSeekTarget({ target: 5000, startAt: 0, headLocal: 3600, canReresolve: false }),
        { kind: 'direct', localTime: 3598, clamped: true },
    );
    // Unknown head: pass through.
    assert.deepEqual(
        decideSeekTarget({ target: 5000, startAt: 0, headLocal: NaN, canReresolve: true }),
        { kind: 'direct', localTime: 5000, clamped: false },
    );
});

test('planResume never restores past the written head', () => {
    assert.deepEqual(planResume({ resumeAt: null, head: 30, finished: false, canSeekResolve: true }),
        { kind: 'none' });
    // Fresh remux, target far ahead: open a session beginning there instead
    // of seeking into unwritten segments (which snaps back to ~0).
    assert.deepEqual(planResume({ resumeAt: 2400, head: 30, finished: false, canSeekResolve: true }),
        { kind: 'seek-resolve', at: 2400 });
    // No re-resolve path (direct file): restore directly, head is the file.
    assert.deepEqual(planResume({ resumeAt: 2400, head: 30, finished: false, canSeekResolve: false }),
        { kind: 'direct', at: 2400 });
    // Covered target: plain restore.
    assert.deepEqual(planResume({ resumeAt: 300, head: 3600, finished: false, canSeekResolve: true }),
        { kind: 'direct', at: 300 });
    // Finished but shorter than memory (stale history): clamp, never overshoot.
    assert.deepEqual(planResume({ resumeAt: 2400, head: 1800, finished: true, canSeekResolve: true }),
        { kind: 'direct', at: 1795 });
    // Unknown head yet: restore directly (coverage handler retries later).
    assert.deepEqual(planResume({ resumeAt: 300, head: NaN, finished: false, canSeekResolve: true }),
        { kind: 'direct', at: 300 });
});

test('shouldDowngradeForDropped only fires on sustained heavy drops', () => {
    const base = { decoded: 1000, dropped: 10 };
    assert.equal(
        shouldDowngradeForDropped(base, { decoded: 1600, dropped: 300 }),
        true,
        '290 drops / ~890 frames in window steps down',
    );
    assert.equal(
        shouldDowngradeForDropped(base, { decoded: 1100, dropped: 20 }),
        false,
        'short window never judges',
    );
    assert.equal(
        shouldDowngradeForDropped(base, { decoded: 1600, dropped: 30 }),
        false,
        'a few startup drops are tolerated',
    );
    assert.equal(
        shouldDowngradeForDropped(base, { decoded: 1600, dropped: 15 }),
        false,
        'clean playback stays',
    );
    assert.equal(
        shouldDowngradeForDropped({ decoded: 1000, dropped: 50 }, { decoded: 1600, dropped: 40 }),
        false,
        'counters never run backwards',
    );
});

test('shouldAutoplayAfterRebuild respects a paused player', () => {
    assert.equal(shouldAutoplayAfterRebuild(false, true), true, 'fresh mount always tries');
    assert.equal(shouldAutoplayAfterRebuild(false, false), true);
    assert.equal(shouldAutoplayAfterRebuild(true, false), true, 'stall while playing resumes');
    assert.equal(shouldAutoplayAfterRebuild(true, true), false, 'paused stays paused');
});

test('audioSwitchStartAt keeps the new audio session where the viewer is', () => {
    // The bug this pins: 40 minutes into a from-the-start session, asking for
    // the session's own origin rebuilds the remux at 0. Its written head is
    // seconds old, the player resumes to 40 minutes against bytes that do not
    // exist, and the switch looks like nothing happened.
    assert.equal(audioSwitchStartAt({ playhead: 2400, sessionStart: 0 }), 2398);

    // Near the opening there is nothing to preserve: stay a plain
    // from-the-start resolve rather than a needlessly seek-started one.
    assert.equal(audioSwitchStartAt({ playhead: 5, sessionStart: 0 }), 0);

    // Seek-started session: the origin is already far in, and the playhead
    // leads it.
    assert.equal(audioSwitchStartAt({ playhead: 1205, sessionStart: 1200 }), 1203);

    // Switch fired before any timeupdate landed: the session origin is still a
    // far better answer than restarting the film.
    assert.equal(audioSwitchStartAt({ playhead: 0, sessionStart: 1200 }), 1198);

    // Junk never turns into a seek past the origin.
    assert.equal(audioSwitchStartAt({ playhead: NaN, sessionStart: 1200 }), 1198);
    assert.equal(audioSwitchStartAt({ playhead: -10, sessionStart: 0 }), 0);
    assert.equal(audioSwitchStartAt({ playhead: Infinity, sessionStart: 0 }), 0);
});

test('subtitleLookupTime undoes the remux clock lead', () => {
    // An fMP4 timeline starts at the first decode timestamp, so with B-frames
    // the picture sits ahead of source time. Subtitle cues are in source time,
    // so without subtracting that lead every line shows early.
    assert.equal(
        subtitleLookupTime({ sessionStart: 0, elementTime: 100, delay: 0, presentationShiftMs: 0 }),
        100,
        'no reorder delay, no correction',
    );
    assert.equal(
        subtitleLookupTime({ sessionStart: 0, elementTime: 100, delay: 0, presentationShiftMs: 167 }),
        99.833,
        '4 B-frames at 24fps',
    );
    // A seek-started session stacks its own origin on top.
    assert.equal(
        subtitleLookupTime({ sessionStart: 3000, elementTime: 100, delay: 0, presentationShiftMs: 167 }),
        3099.833,
    );
    // The viewer's own nudge still applies on top of the correction.
    assert.equal(
        subtitleLookupTime({ sessionStart: 0, elementTime: 100, delay: 1.5, presentationShiftMs: 167 }),
        101.333,
    );
    // Junk from an older server must not move anything.
    for (const bad of [undefined, null, NaN, -50, 'x']) {
        assert.equal(
            subtitleLookupTime({ sessionStart: 0, elementTime: 100, delay: 0, presentationShiftMs: bad }),
            100,
            `ignored: ${String(bad)}`,
        );
    }
    // Never hand back a negative time at the very start of a film.
    assert.equal(
        subtitleLookupTime({ sessionStart: 0, elementTime: 0.05, delay: 0, presentationShiftMs: 167 }),
        0,
    );
});
