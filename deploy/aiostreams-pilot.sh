#!/usr/bin/env bash
set -euo pipefail
cd "${CINEON_ROOT:-/opt/cineon}"
python3 - <<'PY'
from pathlib import Path
import json, secrets, subprocess
state = Path('/var/lib/cineon-aiostreams')
state.mkdir(mode=0o700, exist_ok=True)
state.chmod(0o700)
(state / 'data').mkdir(mode=0o700, exist_ok=True)
env = state / '.env'
if not env.exists():
    env.write_text('BASE_URL=http://aiostreams:3000\nSECRET_KEY=' + secrets.token_hex(32)
        + '\nDATABASE_URI=sqlite://./data/db.sqlite\n'
        'NODE_OPTIONS=--max-old-space-size=256 --max-semi-space-size=8 --expose-gc\n'
        'LOG_LEVEL=warn\nLOG_BUFFER_MAX_BYTES=4194304\nLOG_BUFFER_MAX_ENTRIES=1000\n'
        'STREAM_API_RATE_LIMIT_MAX_REQUESTS=20\nSTREAM_API_RATE_LIMIT_WINDOW=10\n')
env.chmod(0o600)
items = json.loads(subprocess.check_output(['docker', 'inspect', 'cineon-backend']))[0]['Config']['Env']
values = dict(item.split('=', 1) for item in items if '=' in item)
urls = [value.strip().removesuffix('/manifest.json').rstrip('/')
        for value in values.get('STREMIO_ADDONS', '').split(',') if value.strip()]
if not urls:
    raise SystemExit('No existing STREMIO_ADDONS configured for comparison')
config = {'addonName': 'CineVN pilot', 'sortCriteria': {'global': []}, 'formatter': {'id': 'torrentio'},
          'presets': [{'type': 'custom', 'instanceId': 'cinevn-' + str(i), 'enabled': True,
                       'options': {'name': 'CineVN source ' + str(i + 1),
                                   'manifestUrl': url + '/manifest.json', 'timeout': 12000}}
                      for i, url in enumerate(urls)]}
target = state / 'pilot-config.json'
target.write_text(json.dumps(config))
target.chmod(0o600)
print('Prepared private pilot configuration; addon count:', len(urls))
PY
docker compose -f deploy/aiostreams.compose.yml -p cineon-aio up -d
echo 'Pilot only: CineVN provider configuration has not been changed.'
