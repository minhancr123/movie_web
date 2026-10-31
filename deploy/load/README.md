# Load Testing Guide

This directory contains k6 load test scripts for the Cineon platform.

## Prerequisites
- Install [k6](https://k6.io/docs/get-started/installation/)
- Set environment variables `BASE_URL` and `ALLOW_LOAD_TEST=yes`. 
- **Safety guard**: The `ALLOW_LOAD_TEST=yes` environment variable must be explicitly provided to prevent accidental load testing on production environments.

## How to run Web Load Test
Tests the web API (`/api/catalog/home`). Stages VU from 5 to 20 over ~60 mins.
```bash
k6 run -e BASE_URL=http://localhost:3000 -e ALLOW_LOAD_TEST=yes deploy/load/web.js
```

## How to run Media Load Test
Tests the real playback flow: authenticated async resolve, resolve-job polling,
HLS manifest, and the first media segment. Use a dedicated test account token;
never use a personal production token.
```bash
k6 run \
  -e BASE_URL=https://cinevn.me \
  -e ALLOW_LOAD_TEST=yes \
  -e TEST_TOKENS="$CINEVN_LOAD_TEST_TOKENS" \
  -e FIXTURE_TMDB_ID=1272837 \
  -e TEST_4K=true -e FOUR_K_EVERY=10 \
  deploy/load/media.js
```

`FOUR_K_EVERY=10` makes approximately one in ten virtual users request a
2160p-capable profile. The server may still select a lower rendition when the
fixture or writer policy cannot serve 4K. The test requires `TEST_TOKENS` to
contain one comma-separated JWT per VU. Each VU runs exactly one session;
`429` and `503` stop that VU instead of creating a retry loop.

```bash
export CINEVN_LOAD_TEST_TOKENS='JWT_1,JWT_2,...,JWT_100'
```

Use short-lived dedicated test accounts, never an administrator token, and
revoke the accounts after the test.

To provision a temporary pool automatically, run the backend script from a
trusted machine with the backend's MongoDB and JWT environment variables:

```bash
cd backend-node
export LOAD_TEST_ENV_FILE=/secure/path/to/backend.env
export LOAD_TEST_PROVISION=yes
export LOAD_TEST_ACCOUNT_COUNT=100
export LOAD_TEST_ACCOUNT_PREFIX=k6test
export LOAD_TEST_TOKENS_FILE="$PWD/../deploy/load/.tokens"
node scripts/provision-load-test-users.mjs
export CINEVN_LOAD_TEST_TOKENS="$(cat "$LOAD_TEST_TOKENS_FILE")"
```

The script creates ordinary `user` accounts, writes the JWT pool with mode
`0600`, and gives the tokens a two-hour lifetime. Run it against staging when
possible. Do not commit the generated token file.

`LOAD_TEST_ENV_FILE` must point to an existing private environment file
containing `MONGODB_URI`, `JWT_SECRET`, and (if applicable)
`MONGODB_DB_NAME`. If omitted, the script reads `backend-node/.env`.

After testing, remove the pool and its token file:

```bash
export LOAD_TEST_CLEANUP=yes
node scripts/provision-load-test-users.mjs
unset CINEVN_LOAD_TEST_TOKENS
```

## Thresholds
- `p(95) < 1000ms` for Web API, `p(95) < 2000ms` for Media API.
- Failed requests (5xx) must be < 1% (`rate < 0.01`).
