# Serialize far seeks and retain latest intent

Apply after loading-completion-clock.patch.

- Clear the cancelled debounce work reference before immediate seeks. Previously it could remain non-nil indefinitely, preventing confirmed playback from clearing the loader.
- Invalidate local seek completions when a new intent is received, before debounce.
- While resolving a far seek, queue the newest target rather than discard it or seek the outgoing item. Release superseded resolver sessions and serialize the next resolve. Only adopt the final selected target.
- Internal resolve pauses preserve playback intent. New scrubs during loading retain it. Pressing Play with a pending target restores that target instead of starting an unknown outgoing position.

Release/archive/export: CineVN-latest-seek. Xcode builds and device installation checked separately; actual rapid-seek playback still requires on-device verification.
