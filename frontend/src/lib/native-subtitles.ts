/** CineVN renders its own subtitle overlay, including bilingual captions. */
export function suppressNativeSubtitles(video: HTMLVideoElement): () => void {
  const tracks = video.textTracks;
  const disable = () => {
    for (let i = 0; i < tracks.length; i++) {
      const track = tracks[i];
      if ((track.kind === 'subtitles' || track.kind === 'captions') && track.mode !== 'disabled') {
        track.mode = 'disabled';
      }
    }
  };
  // Safari can select an in-band MP4 track after metadata, or add it later.
  // Listen for auto-selection too; leave chapters/metadata tracks untouched.
  const events = ['loadedmetadata', 'loadeddata', 'play'] as const;
  for (const event of events) video.addEventListener(event, disable);
  tracks.addEventListener('addtrack', disable);
  tracks.addEventListener('change', disable);
  disable();
  return () => {
    for (const event of events) video.removeEventListener(event, disable);
    tracks.removeEventListener('addtrack', disable);
    tracks.removeEventListener('change', disable);
  };
}
