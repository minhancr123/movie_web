# Native LAN server preparation

These files target the existing Arch/Omarchy host, not the VPS Docker workflow.
Do not merge the deployment environments or reuse their runtime secrets.

## Release procedure

1. Save `git diff --binary`, untracked files, both private environment files,
   the two service units, and `/etc/nginx/conf.d/movieweb.conf` to a private
   backup directory. Back up MongoDB before switching releases.
2. Fetch GitHub and create a detached worktree under `~/cinevn-releases/<sha>`.
   Leave the original checkout and its edits untouched. Copy environment files
   privately. Set `RELEASE_ID` to this SHA in both runtimes.
3. Install locked dependencies, run backend/frontend tests and build frontend
   in the inactive worktree. Populate standalone `.next/static` and `public`.
   Run frontend on `127.0.0.1`, never a development server in production.
4. Preserve the local backend behavior through `BIND_HOST=127.0.0.1` and
   `TRUST_PROXY_HOPS=1` rather than patching `server.js` on the host.
5. Install the shared Nginx routes/snippets for both HTTP and HTTPS. Preserve
   the existing certificates and tunnel. `nginx -t` must pass before reload.
6. Enable the independent disposable cache on 6380; leave the queue on 6379.
   Set `REDIS_CACHE_URL=redis://127.0.0.1:6380` and keep existing queue credentials.
7. Start with `TRANSCODE_CACHE_MAX_GB=24`, `PLAYBACK_DISK_RESERVE_GB=12`,
   `REMUX_MAX_WRITERS=2`, `PLAYBACK_REMUX_WINDOW_SECONDS=300`,
   `REMUX_READ_RATE=2`, `VIDEO_TRANSCODE_FALLBACK=never`.
   This is a conservative starting point, not an assertion of viewer capacity.
8. Add resource limits and point service working directories/environment files
   to the new worktree. Restart and verify readiness, release SHA, NextAuth
   session JSON, home page and an unauthenticated playback denial.
9. If acceptance fails, restore service overrides/environment paths and Nginx
   configuration from the snapshot, restart the previous release and verify it.

Only inactive build/release directories may be cleaned up. Never delete an
active release, runtime secrets, MongoDB data or media currently leased by a viewer.

## Shared TorBox connection

Set `TORBOX_KEY_MODE=shared` in the private backend environment, then restart
the backend. An admin signs in at `/profile` and connects TorBox once. The
existing provider verification runs before saving the key with AES-256-GCM
under a fixed server owner in `provider_connections`. Keep `TOKEN_ENCRYPTION_KEYS`
stable and backed up privately; the provider secret is never committed to Git.

Authenticated viewers use that shared connection for resolve, prewarm, seek,
refresh and thumbnails. They cannot change/disconnect it or see its fingerprint
or account identity. Playback sessions and media grants remain viewer-scoped.
Shared credentials do not make in-progress remux windows shared across users
or remove upstream/network limits. No real playback is possible until the admin
supplies a valid provider key. No existing personal key is silently migrated.

To roll back the credential policy, set `TORBOX_KEY_MODE=personal` and restart.
Personal connection rows are preserved, while the shared row is unused. Use
the admin profile disconnect button to remove a shared credential if needed.

## Provider-free media checks

Generate synthetic patterns and tones, including a 120-second Full HD sample
and optionally a 40-second **SDR**, 4K HEVC sample on the already-verified GPU:

```sh
python3 deploy/lan/generate-samples.py /data/cinevn-check --gpu
node deploy/lan/check-remux.mjs /data/cinevn-check
```

The latter exercises the real direct/remux decision, embedded subtitle
extraction, H.264 copy/AC3-to-AAC and decode after seeking forward/backward.
It doesn't require, create, or alter user/provider accounts.

Copy `diagnostics.html` as `index.html` and the installed
`frontend/node_modules/hls.js/dist/hls.min.js` into that sample directory.
`nginx-diagnostics.conf` serves it only to localhost and the existing LAN on
8088. Do not forward this port through the router or the public tunnel.
Nginx provides HTTP byte ranges for actual browser seeks. Existing developer
test routes remain disabled in production.

In a browser, verify playback advances, seek to 90 seconds and back to 10,
and confirm the matching Vietnamese cue. Repeat for HLS; test 4K on a device
that supports HEVC. These checks use a small synthetic source. They do not
measure TorBox speed, HDR correctness, the custom player UI or concurrent viewers.

## Public checks

- `/healthz`: backend dependency readiness, 200 only when ready.
- `/api/health`: frontend readiness and live release SHA.
- `/release`: same SHA as the selected worktree.
- `/api/auth/session`: NextAuth JSON, not an Express 404.
- `/api/playback/resolve`: remains protected; missing credentials must not open media.

Cloudflare Tunnel can serve the website/control API. Do not assume it supplies
an unlimited video delivery service. Choose the public media route separately
after provider terms and real upload/concurrency tests are known.
