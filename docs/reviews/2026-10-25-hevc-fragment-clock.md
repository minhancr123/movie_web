# HEVC fragment packet durations and actionable mobile errors

## Reproduction

After the native seek patch, the user still reported repeated cold-load
spinners. Server-side iPhone requests largely returned 200, with no writer
queue; missing bytes/authorization are not established as the primary cause.

A bounded, private 16-MiB prefix of the actual Hope source reproduced a
packaging defect locally on the server. Original HEVC: 24000/1001 fps,
has_b_frames=0, Matroska time base 1/1000. Its first 288 packets had strictly
increasing DTS and PTS. Normal HLS copy changed the boundary keyframe PTS
8.759 -> 8.800, equal to its successor. Concatenated init+individual fragments
confirmed this was in the fMP4 output, not just playlist-demux behavior.

Clearing the copied duration hint with `setts=duration=0` lets the MOV muxer
infer duration from adjacent timestamps. The same source retained all 288
packets, had no non-increasing DTS, maximum PTS deviation 0.313 ms and total
playlist duration 12.010625s. This does not re-encode HEVC payloads, invent a
fixed frame cadence or alter subtitle offsets.

The first broad trial applied this to all HEVC. The existing real Main-10
roundtrip caught a lost final delayed frame in B-frame video, so that trial
was rejected. Production applies it only to **copy HEVC with confirmed zero
B-frames**. Unknown/reordered video and video transcoding retain their recipe.
Legacy probe results missing hasBFrames are re-probed rather than guessed.

## Cache identity

REMUX_BUILD advances to 9. The HEVC no-B-frame duration recipe changes its
rendition identity; old damaged published/live bytes cannot masquerade as the
new output. No existing viewer files are manually deleted.

## Validation and remaining uncertainty

Real FFmpeg tests preserve decoded Main-10 frames for reordered video and
test a 12-second fractional-rate no-B-frame Matroska fixture across fragment
boundaries for packet count, strictly increasing DTS and <2-ms source-clock
error. The actual-source bounded reproduction is operator-private, not a
copyrighted test fixture in Git. Full suites/build and real-phone reload/seek
acceptance remain required before claiming the reported spinner resolved.

Errors now report only bounded media error code, engine enum, ready/network
state and local time through the existing owned telemetry endpoint. Parser
tests discard arbitrary message/URL fields; diagnostic logging adds no
provider URL, key or high-cardinality Prometheus label. This will distinguish
native decoder failures from networking if the symptom persists.

Reference: [FFmpeg setts documentation](https://ffmpeg.org/ffmpeg-bitstream-filters.html#setts).
