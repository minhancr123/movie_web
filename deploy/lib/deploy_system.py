import subprocess
import json
import os
try:
    import fcntl
except ImportError:
    fcntl = None
import urllib.request

class ComposeDeployIO:
    def __init__(self, compose_file, project_name, caddy_api='http://localhost:2019'):
        self.compose_file = compose_file
        self.project_name = project_name
        self.caddy_api = caddy_api
        self._lock_fp = None

    def lock(self):
        lock_file = '/var/run/cineon-deploy.lock' if os.name != 'nt' else 'C:\\cineon-deploy.lock'
        self._lock_fp = open(lock_file, 'w')
        if fcntl:
            fcntl.flock(self._lock_fp, fcntl.LOCK_EX | fcntl.LOCK_NB)
        else:
            print("Windows fallback: no fcntl locking available")

    def current(self):
        try:
            with open('/opt/cineon/current-release.json', 'r') as f:
                return json.load(f)
        except FileNotFoundError:
            return None

    def preflight(self, release):
        pass # assume validate_manifest exists in lib.manifest

    def pull(self, release):
        subprocess.run(['docker', 'compose', '-f', self.compose_file, '-p', self.project_name, 'pull'], check=True)

    def maintenance_state(self):
        try:
            req = urllib.request.Request(f'{self.caddy_api}/config/apps/http/servers/srv0/routes/0')
            with urllib.request.urlopen(req) as res:
                data = json.loads(res.read())
                return data.get('handle', [{}])[0].get('handler') == 'static_response' and data.get('handle', [{}])[0].get('status_code') == 503
        except Exception:
            return False

    def maintenance(self, on):
        if on:
            config = {
                "match": [{"host": ["*"]}],
                "handle": [{"handler": "static_response", "status_code": 503, "body": "Maintenance Mode"}]
            }
        else:
            config = {"match": [{"host": ["*"]}], "handle": [{"handler": "reverse_proxy", "upstreams": [{"dial": "localhost:3000"}]}]}
            
        req = urllib.request.Request(f'{self.caddy_api}/config/apps/http/servers/srv0/routes/0', method='PUT' if on else 'PATCH')
        req.add_header('Content-Type', 'application/json')
        try:
            urllib.request.urlopen(req, data=json.dumps(config).encode('utf-8'))
        except Exception as e:
            print("Caddy API not reachable or error:", e)

    def apply(self, release):
        subprocess.run(['docker', 'compose', '-f', self.compose_file, '-p', self.project_name, 'up', '-d'], check=True)

    def verify(self, release):
        try:
            req = urllib.request.Request('http://localhost/api/health')
            with urllib.request.urlopen(req, timeout=5) as res:
                return res.status == 200
        except Exception:
            return False

    def commit(self, release, previous):
        # In a real scenario, this writes to /opt/cineon
        print(f"Commit release {release}")

    def restore_current(self, r):
        print(f"Restore release {r}")

    def stop_candidate(self):
        subprocess.run(['docker', 'compose', '-f', self.compose_file, '-p', self.project_name, 'down'], check=True)

    def notify(self, event):
        print(f"NOTIFY: {event}")
