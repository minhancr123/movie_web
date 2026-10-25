#!/usr/bin/env python3
"""Bounded, paced LAN byte-range benchmark using synthetic sample files only.

This is delivery capacity, not browser decoding, provider or WAN load testing.
Run from another machine so loopback does not hide the network bottleneck.
"""
import argparse
import concurrent.futures
import datetime
import ipaddress
import json
import math
import random
import time
import urllib.parse
import urllib.request
from pathlib import Path


def percentile(values, fraction):
    ordered = sorted(values)
    return ordered[max(0, math.ceil(len(ordered) * fraction) - 1)] if ordered else None


def fetch_range(url, offset, length, timeout=4):
    started = time.monotonic()
    req = urllib.request.Request(url, headers={
        'Range': f'bytes={offset}-{offset + length - 1}',
        'Accept-Encoding': 'identity',
    })
    with urllib.request.urlopen(req, timeout=timeout) as response:
        if response.status != 206:
            raise ValueError(f'Expected HTTP 206, got {response.status}')
        prefix = f'bytes {offset}-{offset + length - 1}/'
        if not response.headers.get('Content-Range', '').startswith(prefix):
            raise ValueError('Incorrect byte range returned')
        total = 0
        first_byte_ms = None
        while True:
            data = response.read(min(65536, length - total + 1))
            if not data:
                break
            if first_byte_ms is None:
                first_byte_ms = (time.monotonic() - started) * 1000
            total += len(data)
            if total > length:
                raise ValueError('Upstream exceeded requested range')
        if total != length:
            raise ValueError(f'Truncated range: {total}/{length}')
    return total, (time.monotonic() - started) * 1000, first_byte_ms


def measure(url, viewers, mbps, seconds):
    with urllib.request.urlopen(urllib.request.Request(url, method='HEAD'), timeout=5) as response:
        size = int(response.headers['Content-Length'])
    length = int(mbps * 1_000_000 / 8)
    if size < length:
        raise ValueError('Synthetic file must exceed one second of target traffic')
    # Validate ranges before creating any concurrent load.
    fetch_range(url, 0, 1024)
    start = time.monotonic() + 0.25

    def viewer(index):
        rng = random.Random(index)
        results, errors, missed = [], [], 0
        for step in range(seconds):
            due = start + step
            if time.monotonic() > due + 1:
                missed += 1
                continue
            time.sleep(max(0, due - time.monotonic()))
            try:
                result = fetch_range(url, rng.randint(0, size - length), length)
                results.append(result)
                if time.monotonic() > due + 1:
                    missed += 1
            except Exception as error:
                errors.append(str(error))
                missed += 1
        return results, errors, missed

    with concurrent.futures.ThreadPoolExecutor(max_workers=viewers) as pool:
        outcomes = list(pool.map(viewer, range(viewers)))
    elapsed = max(seconds, time.monotonic() - start)
    results = [result for rows, _, _ in outcomes for result in rows]
    errors = [error for _, errors, _ in outcomes for error in errors]
    transferred = sum(row[0] for row in results)
    return {
        'connections': viewers, 'mbps_per_connection': mbps,
        'target_total_mbps': viewers * mbps, 'planned_seconds': seconds,
        'elapsed_seconds': round(elapsed, 3), 'bytes': transferred,
        'measured_mbps': round(transferred * 8 / elapsed / 1_000_000, 2),
        'successful_requests': len(results), 'expected_requests': viewers * seconds,
        'errors': errors, 'missed_one_second_deadlines': sum(row[2] for row in outcomes),
        'range_p95_ms': percentile([round(row[1], 2) for row in results], .95),
        'first_64k_p95_ms': percentile([round(row[2], 2) for row in results], .95),
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--base', required=True, help='LAN diagnostic origin, e.g. http://192.168.100.14:8088')
    parser.add_argument('--seconds', type=int, default=12)
    parser.add_argument('--connections', type=int, nargs='+', default=[5, 10, 20])
    parser.add_argument('--rates', type=int, nargs='+', default=[8, 25])
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    parsed = urllib.parse.urlsplit(args.base)
    host = ipaddress.ip_address(parsed.hostname)
    if parsed.scheme != 'http' or not host.is_private or parsed.username or parsed.password:
        parser.error('Use a private LAN HTTP diagnostic origin without credentials')
    if not 1 <= args.seconds <= 30 or any(not 1 <= n <= 20 for n in args.connections):
        parser.error('Bounded benchmark: 1–30 seconds, 1–20 connections')
    if any(rate not in [8, 25] for rate in args.rates):
        parser.error('Supported synthetic profiles: 8 or 25 Mbps')
    report = {'measured_at': datetime.datetime.now(datetime.timezone.utc).isoformat(),
              'scope': 'Synthetic LAN HTTP ranges; no provider, browser decoding, production sessions or WAN.',
              'base': args.base, 'phases': []}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    for rate in args.rates:
        sample = 'fullhd.mp4' if rate == 8 else '4k.mp4'
        for count in args.connections:
            result = measure(args.base.rstrip('/') + '/' + sample, count, rate, args.seconds)
            report['phases'].append(result)
            args.output.write_text(json.dumps(report, indent=2) + '\n')
            args.output.chmod(0o600)
            print(json.dumps(result), flush=True)
            time.sleep(1)


if __name__ == '__main__':
    main()
