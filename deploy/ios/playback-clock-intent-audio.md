# Native clock, seek play intent and audio gestures

Apply after unified-loading-state.patch.

- The periodic AVPlayer clock owns progress and subtitle timing. Pending seek targets stay separate; dragging still previews the intended timestamp. Rapid skip taps accumulate from the pending intent.
- Scrub commits carry the pre-drag playing state; resume happens after a successful seek lands within one second of the requested absolute position. Failed/cancelled current seeks show an error rather than advertising success or spinning indefinitely. Superseded seeks remain ignored.
- Replacement items wait for the restoration seek before starting playback. Far seek retains the pre-seek intent across the resolve pause.
- Reactivate AVAudioSession when playing. Gesture direction locks only after clear dominant movement, reducing accidental volume changes during diagonal seeks. This does not establish that every reported silent source was caused by a gesture.

Archive/export/install target: CineVN-playback-intent, physical iPhone 17 Pro Max. Real playback and audio verification remain necessary.
