# Confirm loading completion from playback progress

Apply after playback-clock-intent-audio.patch.

The periodic observer samples the current AVPlayer item clock. Consecutive forward progress near the committed target clears stale buffer state and pending restoration. Queued/in-flight seeks cannot be mistaken for successful playback. A one-second grace avoids changing state between ordinary clock ticks. Loading presentation stops once current-item progress is confirmed. The pause poster cannot appear while loading or seek restoration remains active, including the overlay hide grace.

Archive/export/install: CineVN-loading-completion. Xcode validation does not replace on-device playback verification.
