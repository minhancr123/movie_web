# Breaking Bad S02E07: missing Vietnamese and repeated window loads

Measured against the LAN backend:
- SubDL listed 5 Vietnamese and 5 English tracks in 14.6 seconds. The old
  5-second list deadline discarded them, then cached the partial inventory 6h.
- Nhamsub returned a data-URI placeholder, not a usable HTTPS subtitle. Other
  responding addons returned English/other languages, not Vietnamese.
- Embedded extraction exceeded 120 seconds, then retried the same remote input
  track by track. Subtitle demux competes with playback for upstream bandwidth.
- 4K video around 59 Mbps was priced into a 122-second remux window by the fixed
  1 GiB budget. Budget shortening is intentional, but it creates frequent handoffs.

Changes:
- Give SubDL listing up to 20s, retaining bounded 5s sidecar reads. Failed/partial
  discovery caches only 60s. Bump the subtitle list cache version.
- Pending embedded tracks remain in the menu but cannot auto-displace ready
  sidecars. A published embedded track can still upgrade automatically.
- At >=20 Mbps, extract only 60 seconds around the playhead with 30s overlap.
  Queue waiting is bounded to 15s; these scans are bounded to 45s. A network/queue
  timeout does not retry every track from the same input. Preserve atomic VTT
  publication and explicit extracted coverage; never relabel empty data as ready.
- Prepare the next video window up to 45s early. Keep matching preparation work
  instead of cancelling and resolving the same boundary again. Source, audio
  and seek generation must still agree.
- Add PLAYBACK_REMUX_WINDOW_MAX_MB, default 1024, bounded 256..4096. LAN uses
  3072 with the existing 48 GiB total cache cap, four-writer limit and disk
  admission checks. At 59 Mbps this permits roughly 6 minutes per window.

Native app verification:
The signed archive installed during the previous task links AVPlayer/AVPlayerItem.
The attached phone reports com.minhancr123.cinevn installed. Its preferences use
Auto by default (playbackMode unset); its prior directPenaltyUntil has expired.
Only these two settings were inspected; the temporary preference copy was removed.
No native engine migration or new IPA is part of this server/web repair.

Limits: this reduces the frequency and preparation cost of HLS handoffs; it is
not a claim of gapless HLS playback or that MKV becomes direct-playable in AVPlayer.
Online Vietnamese subtitles still need release/timeline validation by the existing
alignment machinery. A language being available is not proof of perfect sync.

Follow-up download verification: all five Vietnamese SubDL action URLs returned
one-cue quota notices, not actual dialogue (daily download limit reached). They
must not be offered as valid subtitles. The normalizer now emits a structured
SUBTITLE_DOWNLOAD_LIMIT warning; partial discovery retries after 60s and the
player inventory explains the missing Vietnamese track. Fixing the timeout alone
cannot restore a provider account's exhausted download quota.

Live verification after the first repair: owned S02E07 inventory HTTP 200 in
19.7s; English embedded 60s window published 6 cues successfully, finishing 31.7s
after request start (about 12s after inventory). Vietnamese remains unavailable
from this exhausted account; no translation or fake track was substituted.
