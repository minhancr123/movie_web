# iOS source discovery during a TorBox outage

The affected screen is the native Swift app in Documents/CineVN-IOS, not the
Safari player. User explicitly deferred the separate iPhone seeking issue.
No player/seek implementation was changed in this task.

## Evidence

Production logs for Hope showed three automatic resolves taking 43.3, 26.4
and 23.0 seconds. Each walked five TorBox candidates; magnet creation returned
HTML/non-JSON 404 during the announced provider maintenance. Only afterwards
did the existing Vimo direct fallback return 200. Ranking also spent up to
12.2 seconds checking provider cache state.

Native app retried three times using Vietnamese message substring matching
or any URL error. Stage polling kept the first resolve ID even when retries
created another one. Cancellation could be swallowed during sleep, and a
cancelled task could clear state belonging to a newer request.

## Backend

- A 30-second process-local cooldown opens for malformed provider payloads
  or gateway 5xx, keeping no account data/keys/URLs. No repeated API requests
  for sibling releases while open; after expiry real requests resume.
- Valid missing-file, account authorization and plan errors retain their
  meaning. HTML maintenance/edge pages do not invalidate a healthy key.
- Auto source selection stops walking a provider-wide failure and proceeds
  to its existing flagged CDN fallback. A pinned source stays pinned and
  receives structured PROVIDER_UNAVAILABLE, retryable=false and retry delay.
- Existing local reusable media can still be selected. No invented healthy
  provider response, aggressive poller or external playback endpoint.

## Native app

Local Swift changes: at most two attempts within a 60-second target budget;
per-attempt network timeout capped at 30s/remaining budget. Retry only known
transient codes explicitly marked retryable or specific transient URL errors.
Provider maintenance, unsupported media, offline and cancellation do not loop.
Poll the actual active resolve ID and protect state with request generation.
HTTP error bodies preserve code/retryability without decoding an error as a
successful PlaybackSession; invalid error payloads receive a safe message.

The iOS directory is not a Git repository. Original touched files are backed
up privately; a patch and build artifacts are retained outside this repo.
Backend Git commits do not install Swift changes on an iPhone: signed device
build and physical installation are separate acceptance steps.

## Verification

Backend tests cover HTML outage, one API call rather than sibling retries,
creation endpoint failure, cooldown expiry and credential privacy. Standalone
Swift policy checks cover structured retries, maximum attempts, total budget,
offline and cancellation. Build native app for simulator and signed device;
run backend/frontend suites and frontend build before activating the backend.
Live provider maintenance can still prevent a film from being available; these
changes shorten failure/fallback handling rather than promise source availability.
