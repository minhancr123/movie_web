# Accurate seek and preview

Apply after resume-buffer-consistency.patch.

- Remove unlimited AVPlayer seek tolerances. All committed seeks request the exact target; completion displays the actual player clock rather than fabricating successful arrival.
- Observe the thumbnail store in a dedicated view so async image arrivals redraw while the finger is stationary. Clear stale bucket images, reject negative prefetch buckets, and service the latest requested bucket after an in-flight fetch.
- Preview images remain sampled in five-second buckets; the displayed target time is the exact seek intent, not the thumbnail sampling timestamp.

Release archive and IPA: CineVN-accurate-seek. Build and export validated with Xcode; real-device seek/network behavior requires playback verification.
