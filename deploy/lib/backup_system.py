import subprocess
import os
import json
try:
    import fcntl
except ImportError:
    fcntl = None

class SystemBackupIO:
    def __init__(self, config):
        self.database_name = config.get('database_name')
        self.mongo_config_path = config.get('mongo_config_path')
        self.redis_cli = config.get('redis_cli', 'redis-cli')
        self.restic_repo = config.get('restic_repo')
        self.restic_password_file = config.get('restic_password_file')
        self._lock_fp = None

    def lock(self):
        lock_file = '/var/run/cineon-ops.lock' if os.name != 'nt' else 'C:\\cineon-ops.lock'
        self._lock_fp = open(lock_file, 'w')
        if fcntl:
            fcntl.flock(self._lock_fp, fcntl.LOCK_EX | fcntl.LOCK_NB)
        else:
            print("Windows fallback: no fcntl locking available")

    def preflight(self):
        pass

    def running_services(self):
        out = subprocess.run(['docker', 'compose', 'ps', '--format', 'json'], capture_output=True, text=True, check=False)
        if out.returncode != 0: return []
        try:
            return [s['Service'] for s in json.loads(out.stdout)]
        except:
            return []

    def maintenance_state(self):
        return False

    def maintenance(self, on):
        pass

    def stop_writers(self, services):
        if services:
            subprocess.run(['docker', 'compose', 'stop'] + services, check=True)

    def capture(self, db_name):
        subprocess.run(['mongodump', f'--config={self.mongo_config_path}', '--db', db_name, '--out', '/tmp/dump'], check=True)
        subprocess.run([self.redis_cli, 'SAVE'], check=True)

    def resume(self, services):
        if services:
            subprocess.run(['docker', 'compose', 'start'] + services, check=True)

    def publish(self, staging, metadata):
        env = os.environ.copy()
        if self.restic_password_file:
            env['RESTIC_PASSWORD_FILE'] = self.restic_password_file
        subprocess.run(['restic', '-r', self.restic_repo, 'backup', staging], env=env, check=True)

    def verify_snapshot(self, snapshot_id):
        env = os.environ.copy()
        if self.restic_password_file:
            env['RESTIC_PASSWORD_FILE'] = self.restic_password_file
        subprocess.run(['restic', '-r', self.restic_repo, 'check'], env=env, check=True)

    def mark_success(self, snapshot_id):
        pass

    def notify(self, msg, error=False):
        print(f"NOTIFY{' (ERROR)' if error else ''}: {msg}")
