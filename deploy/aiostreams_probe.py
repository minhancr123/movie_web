#!/usr/bin/env python3
"""Compare addon HTTP responses with a private AIOStreams pilot. No URLs/keys logged."""
import base64
import json
import re
import sys
import time
import urllib.request
import urllib.error
from pathlib import Path

STATE = Path('/var/lib/cineon-aiostreams')
CASES = [('movie', 'tt0133093'), ('movie', 'tt15398776'),
         ('series', 'tt0903747:1:1'), ('series', 'tt4644488:1:1')]


def fetch(url, headers=None):
    request = urllib.request.Request(url, headers={'User-Agent': 'MovieWeb/1.0', **(headers or {})})
    with urllib.request.urlopen(request, timeout=35) as response:
        return json.load(response)


def hashes(rows):
    found = set()
    for row in rows:
        candidate = row.get('infoHash') or ''
        if not re.fullmatch('[a-fA-F0-9]{40}', candidate):
            match = re.search(r'urn:btih:([a-fA-F0-9]{40})', row.get('url') or '')
            candidate = match.group(1) if match else ''
        if candidate:
            found.add(candidate.lower())
    return found


def query(mode, config, kind, media_id):
    started = time.monotonic()
    try:
        if mode == 'direct':
            rows = []
            for preset in config['presets']:
                if preset['type'] != 'custom':
                    continue
                base = preset['options']['manifestUrl'].removesuffix('/manifest.json').rstrip('/')
                rows.extend(fetch(base + '/stream/' + kind + '/' + media_id + '.json').get('streams', []))
            errors = 0
        else:
            data = fetch('http://127.0.0.1:3100/api/v1/search?type=' + kind + '&id=' + media_id,
                         {'x-aiostreams-user-data': base64.b64encode(json.dumps(config).encode()).decode()})
            if not data.get('success'):
                raise RuntimeError('AIO search failed')
            rows = (data.get('data') or {}).get('results', [])
            errors = len((data.get('data') or {}).get('errors', []))
        return {'seconds': round(time.monotonic() - started, 3), 'rows': len(rows),
                'unique': len(hashes(rows)), 'source_errors': errors}, hashes(rows)
    except urllib.error.HTTPError as error:
        return {'seconds': round(time.monotonic() - started, 3), 'error_type': 'HTTPError',
                'http_status': error.code}, set()
    except Exception as error:
        # Error text can include credential-bearing provider URLs.
        return {'seconds': round(time.monotonic() - started, 3), 'error_type': type(error).__name__}, set()


def main():
    single = json.loads((STATE / 'pilot-config.json').read_text())
    multi = json.loads(json.dumps(single))
    bounded = '--bounded' in sys.argv
    options = {}
    if bounded:
        comet = {'maxResultsPerResolution': 15, 'maxSize': 0, 'cachedOnly': False,
                 'removeTrash': True, 'resultFormat': ['all'], 'debridServices': [],
                 'enableTorrent': True, 'languages': {'required': [], 'exclude': [], 'preferred': []},
                 'resolutions': {}}
        encoded = base64.b64encode(json.dumps(comet, separators=(',', ':')).encode()).decode()
        options['url'] = 'https://comet.feels.legal/' + encoded + '/manifest.json'
        multi['resultLimits'] = {'global': 150}
        profile = STATE / 'pilot-multi-config.json'
    multi['presets'].append({'type': 'comet', 'instanceId': 'cinevn-comet', 'enabled': True, 'options': options})
    if bounded:
        profile.write_text(json.dumps(multi))
        profile.chmod(0o600)
    results = []
    for round_name in ['initial', 'repeat']:
        for kind, media_id in CASES:
            direct, baseline = query('direct', single, kind, media_id)
            aio, same_sources = query('aio', single, kind, media_id)
            extra, multi_sources = query('aio', multi, kind, media_id)
            record = {'round': round_name, 'type': kind, 'id': media_id, 'direct': direct,
                      'aio_same_sources': aio, 'aio_with_comet': extra,
                      'same_source_overlap': len(baseline & same_sources),
                      'extra_unique_with_comet': len(multi_sources - baseline)}
            results.append(record)
            print(json.dumps(record), flush=True)
    output = STATE / ('comparison-bounded.json' if bounded else 'comparison.json')
    output.write_text(json.dumps({'note': 'HTTP-level comparison; bypasses CineVN Redis cache. Direct runs first; upstream caches may favour AIO. These are source lists, not playback verification.', 'samples': results}, indent=2))
    output.chmod(0o600)


if __name__ == '__main__':
    main()
