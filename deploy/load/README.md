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
Tests the media playback endpoints. Simulates video clients requesting bitrate data.
```bash
k6 run -e BASE_URL=http://localhost:3000 -e ALLOW_LOAD_TEST=yes -e FIXTURE_MEDIA_ID=fixture-123 deploy/load/media.js
```

## Thresholds
- `p(95) < 1000ms` for Web API, `p(95) < 2000ms` for Media API.
- Failed requests (5xx) must be < 1% (`rate < 0.01`).
