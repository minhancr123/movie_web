# Interstellar decoder suspension and bounded source failover

Frontend production: `659b8576597ef452c6fd079000bbd9183d567a84`.
Backend remains `71e20eb` (no restart or backend changes).

The reported tab stopped around 21:52 while using an existing seek-window remux
beginning at 1307.681 seconds. Backend telemetry at 18:37:54 +07 recorded an MSE
media error3 at localTime5.308 with readyState4. The browser's media-internals
showed enough audio/video buffer, VideoToolboxVideoDecoder rejection -12909,
video decode error, and a suspended pipeline. It also logged non-IDR recovery
point/keyframe warnings. Software FFmpeg decoded the first18s without video
errors; this does not establish compatibility with Apple's hardware decoder,
or establish that the warnings alone caused the hardware rejection.

The player listened for element errors only in native/direct paths. hls.js can
report MEDIA_SOURCE_REQUIRES_RESET as nonfatal after a decoder closes MSE; that
was ignored. Browser-induced pause also looked like an intentional user pause,
so the stall watchdog could not rescue it. One old recovery recreated the same
source and failed again at localTime5.307909.

The MSE loader now observes element decoder errors3/4 and calls the existing
source failover policy once. Its hls.js event path also checks the actual media
error regardless of the fatal flag. The two signals share a reentrancy guard;
abort/network errors retain their retry policy. Before teardown, the confirmed
full-film position and pre-error pause intent are preserved. The parent excludes
failed source tokens and bounds failovers per title. Actual decoder rejection
is not retried indefinitely on identical bytes. Existing recovery policy remains
for other media errors. Service worker revisionv8 updates the player bundle.

Validation: full frontend npm test and production build passed. Added element
error regressions for paused/readyState4, repeated and nested events, abort and
network errors followed by decode rejection, and retired-element cleanup. Source
integrity checked all446 files. Frontend-only systemd activation has readiness
and rollback in ~/cinevn-deploy-backups/20261101-659b8576597ef452c6fd079000bbd9183d567a84/.

Real production browser verification: reloaded the previously frozen Interstellar
tab. The same old source reproduced error3 at localTime5.314 (18:45:00). The new
handler changed source, requesting startAt1312. Replacement resolve returned200
in4.0s at18:45:08. The UI resumed near21:52 and advanced through22:05 to22:40
with the Pause control visible. Left the user's original tab playing; closed the
extra media-internals diagnostic tab. This validates source failover, not a
repair of the original bitstream or a guarantee of playback through the entire
film. The replacement is the existing1080p Vimo fallback because disk admission
still rejects creating the selected main remux with about23GiB filesystem free.
No sessions, source files or cached media were deleted.
