# Native HLS destination loading

After f7f53b2, the user confirmed the second mobile-data reload played smoothly,
but reported slow seeking. Server logs returned reuse in 0–0.3 seconds for
positions 571 and 688; no new FFmpeg processing was needed. One cold reload
had still reported a media error, so cold-start acceptance is not complete.

The native restore gate only accepted destination coverage from element
seekable/buffered ranges. WebKit may leave these empty until currentTime asks
for the destination, creating a wait-before-request dependency. Use finite
**element** duration as additional evidence that the HLS playlist contains the
target, then issue the seek. Never use the advertised full-film UI duration.
Unknown/infinite or shorter playlists still require real range coverage.

The existing restore gate continues to require seek completion, decoded data
and the correct position before playing, so this does not resume from the
previous keyframe. Set preload=auto to request native destination/first-frame
loading while restore pauses the element; the browser can still limit preload.

Regression test uses an empty-range 900-second native playlist, seeks to 688
at metadata readiness, then requires seeked plus loadeddata before playback.
It rejects both a 300-second playlist and unknown infinite extent. Retest on
the same physical iPhone after deployment; this does not prove mobile-network
throughput, fix every cold error or certify 100 viewers.
