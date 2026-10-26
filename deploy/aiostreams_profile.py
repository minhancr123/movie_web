#!/usr/bin/env python3
"""AIO metadata discovery only; no provider credentials are saved in this profile."""
import copy
import json
from pathlib import Path
from aiostreams_quack import build_profile as quack_profile

DEFAULT_ADDONS = ('torrentio', 'comet', 'meteor', 'stremthruTorz', 'mediafusion', 'torrents-db')
REQUEST_ADDONS = ('knaben', 'peerflix', 'sootio')

def add_request_presets(status, current):
    profile = copy.deepcopy(current)
    metadata = status.get('data', status).get('settings', {}).get('presets', [])
    available = {p['ID']: p for p in metadata if not p.get('DISABLED')}
    existing = {p['type'] for p in profile.get('presets', [])}
    profile['cinevnRequestPresets'] = [
        {'type': name, 'instanceId': 'cinevn-request-' + name, 'enabled': True,
         'options': {'name': available[name]['NAME'], 'timeout': 8000,
                     'useMultipleInstances': False, 'includeP2P': True, 'showTorrentLinks': True, 'mediaTypes': []}}
        for name in REQUEST_ADDONS if name in available and name not in existing]
    return profile

def build_profile(status, current=None, addons=DEFAULT_ADDONS):
    metadata = status.get('data', status).get('settings', {}).get('presets', [])
    available = {p['ID']: p for p in metadata if not p.get('DISABLED')}
    selected = [name for name in addons if name in available]
    if not selected:
        raise ValueError('No requested addons supported by this AIOStreams instance')
    profile = quack_profile(current or {'presets': []})
    profile['presets'] = [{'type': name, 'instanceId': 'cinevn-' + name, 'enabled': True,
        'options': {'name': available[name]['NAME'], 'timeout': 3000, 'useMultipleInstances': False,
                    'includeP2P': True, 'showTorrentLinks': True, 'mediaTypes': []}}
        for name in selected]
    # Preserve the full quality spread; CineVN applies device-aware direct-play ranking.
    profile['resultLimits'] = {'global': 150, 'resolution': 40}
    return add_request_presets(status, profile)

if __name__ == '__main__':
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument('status', type=Path)
    parser.add_argument('output', type=Path)
    parser.add_argument('--addons', default=','.join(DEFAULT_ADDONS))
    parser.add_argument('--requests-only', action='store_true')
    parser.add_argument('--current', type=Path)
    args = parser.parse_args()
    status = json.loads(args.status.read_text())
    if args.requests_only and not args.current:
        parser.error('--requests-only requires --current')
    profile = add_request_presets(status, json.loads(args.current.read_text())) if args.requests_only else build_profile(status, addons=args.addons.split(','))
    args.output.touch(mode=0o600, exist_ok=True)
    args.output.chmod(0o600)
    args.output.write_text(json.dumps(profile))
    print('Enabled metadata addons:', ', '.join(p['type'] for p in profile['presets']))
