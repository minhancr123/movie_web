# Remux admission queue and cross-viewer cold-start coalescing

## Behavior

- Keep four FFmpeg writers. Requests needing a new writer join a bounded,
  process-local admission queue instead of failing after short HTTP retries.
- Foreground seeks/continuations precede new plays; speculative next-window
  preparation has lower priority. Aging prevents indefinite starvation.
- A keyed gate covers rendition/seek bucket/window through reusable-session
  insertion. Other viewers then re-check adoption using their own authorized
  session rows. Completed bytes may be adopted before the next publication tick.
- No provider key, upstream URL or another user's session is returned by queue
  status. Results and cancellation are restricted to the authenticated owner.
- Only opted-in `asyncQueue:true` clients use pending job replies. Fast paths
  return the ordinary response. A real slot/key wait returns 202 with an opaque
  job ID; authenticated GET polls and DELETE cancels it. Old tabs keep the
  original synchronous contract.
- Pending-job polling renews a 90-second lease. Abandoned jobs cancel the
  controller switch signal; work expires after 15 minutes overall. The writer
  queue waits at most 10 minutes, holds at most 128 waiters; jobs are capped at
  256 with four pending jobs per account. Completed replies expire after 60s.
- Polling retries short network interruptions without issuing another resolve.
  Long-queued upstream URLs refresh after admission. All reservation failure,
  cancellation and TTL paths still obey the existing atomic writer ceiling.
- Export `remux_queue_depth`. Queue detail changes preserve phase timing and
  active owned polls keep long waits from disappearing from stage tracking.

## Verification

Unit tests cover 12 requests/4 slots, priority/FIFO/aging, bounds/timeouts,
abort/admission races, cancellation, one build for 12 same-key viewers,
owner-only job delivery, worker lease cleanup, disconnected sockets and client
poll completion/cancellation/error handling. An isolated real FFmpeg regression
checks that waiting cannot spawn early and cancellation returns reservations.

The built-in browser exercised the shipped queue, keyed gate, async-job adapter
and TypeScript polling helper through a loopback HTTP fixture: two distinct
synthetic users waited while all four slots were held; both received results
from one shared build when capacity became available. This fixture does not
use production identities, TorBox or real movies and is not a 100-viewer test.

Only the playback process owns these local queues; do not add multiple backend
worker processes without shared scheduling. Limits and window/read-rate settings
remain at the existing production values. This change does not reduce per-viewer
origin egress or certify 100 concurrent 4K streams.
