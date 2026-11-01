# Verity startup: remove a failed preliminary probe

Backend production: `2360b8296b71ca379800a76982cea9a9d8b62597`, activated
2026-11-01 13:50:55 +07. Frontend remains `7803d56`.

The user reported about 20 seconds before playback on movie 1283515. The
corresponding backend timeline showed 14.9 seconds: sources 1.5, rank 0.7,
prepare 7.2, link 0.8, probe phase 4.6 seconds. This timeline does not measure
the complete interval to the browser's first rendered frame.

The imported runtime optimization downloaded the first/last 4 MiB, concatenated
them and ran a local probe before native URL probing. On the actual Verity MP4,
the preliminary probe returned null. One measurement cost 3,512 ms before the
ordinary remote probe, which succeeded in 997 ms with H.264/AAC metadata.
Native ffprobe already seeks to container metadata using HTTP ranges, retaining
the original offsets. The concatenation stage was removed; existing alternate
CDN probe behavior remains, with duplicate URLs removed before launching probes.

Three fresh-process paired measurements on the same selected Verity file:

| Trial | Previous combined path | Native URL probe |
| --- | ---: | ---: |
| 1 | 2,914 ms | 2,062 ms |
| 2 | 2,891 ms | 1,505 ms |
| 3 | 5,792 ms | 1,192 ms |

Every preliminary probe failed; both paths ultimately returned matching H.264,
AAC and 6,669.717333-second duration. Measurements are not an end-to-end browser
startup benchmark and do not establish a universal reduction from 20 seconds.
Provider preparation remains a separate cost (7.2 seconds in the reported run;
2,291 ms in a subsequent existing-source measurement).

Validation: full backend `npm test` passed on LAN with isolated Redis URLs and
ffmpeg/ffprobe installed. Added a real tail-moov MP4 HTTP fixture with a 12 MiB
free box; it proves native ffprobe seeks to distant metadata and returns the
correct video, audio and duration. Source integrity checked all 219 backend
files. Public health serves the new release. Production resolve for the same
pinned Verity source returned 200/direct in 2,109 ms using existing metadata
caches; a separate audit viewer identity was used and its lease released.

The user's pasted shell output included `ffprobe: command not found`, so those
particular shell "probe failed" messages cannot establish invalid media. The
sample combined file already on LAN successfully probed as Matroska; it is not
the Verity MP4 used for the measurements above.

Rollback and activation record:
`~/cinevn-deploy-backups/20261101-2360b8296b71ca379800a76982cea9a9d8b62597/`.
