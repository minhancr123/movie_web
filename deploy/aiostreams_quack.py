#!/usr/bin/env python3
"""Build a bounded, account-scoped QuackStart profile; never stores a debrid key."""
import copy
import json
import os
from pathlib import Path
import sys

RULES = Path(__file__).parent / 'aiostreams/quackstart-rules.json'


def build_profile(current, rules=None):
    rules = rules or json.loads(RULES.read_text())
    profile = copy.deepcopy(current)
    for key in ['titleMatching', 'yearMatching', 'seasonEpisodeMatching', 'deduplicator',
                'sortCriteria', 'digitalReleaseFilter', 'rankedStreamExpressions']:
        profile[key] = copy.deepcopy(rules[key])
    # Existing Torrentio + bounded Comet remain the fallback discovery base.
    additions = copy.deepcopy(rules['presets'])
    existing = {p['type'] for p in profile['presets']}
    profile['presets'].extend(p for p in additions if p['type'] not in existing)
    for preset in profile['presets']:
        preset['options']['timeout'] = min(preset['options'].get('timeout', 3000), 3000)
    profile.update({
        'addonName': 'CineVN QuackStart',
        'cinevnAccountScoped': True,
        'services': [{'id': 'torbox', 'enabled': False, 'credentials': {}}],
        'serviceWrap': {'enabled': True, 'reconfigureService': False},
        'excludedStreamExpressions': [{'expression': "uncached(type(streams, 'debrid'))", 'enabled': True}],
        'resultLimits': {'global': 150, 'resolution': 40},
        'formatter': {'id': 'torrentio'},
        # The API is discovery only; CineVN owns URL minting and prewarming.
        'preloadStreams': {'enabled': False},
        'precacheNextEpisode': False,
        'enableSeadex': True,
    })
    return profile


if __name__ == '__main__':
    target = Path(sys.argv[2])
    profile = build_profile(json.loads(Path(sys.argv[1]).read_text()))
    fd = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, 'w') as output:
        json.dump(profile, output)
    target.chmod(0o600)
    print('Prepared private QuackStart profile; no debrid credentials stored.')
