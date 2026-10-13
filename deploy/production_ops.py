#!/usr/bin/env python3
"""Production probes, bounded recovery, encrypted backups and isolated restore drills."""
import argparse
import contextlib
import fcntl
import grp
import json
import os
from pathlib import Path
import secrets
import sqlite3
import re as regex
import shutil
import subprocess
import tempfile
import time
import urllib.request

ROOT = Path(os.getenv('CINEON_ROOT', '/opt/cineon'))
STATE = Path(os.getenv('CINEON_OPS_STATE', '/var/lib/cineon-ops'))
METRICS = Path('/var/lib/alloy/textfile')
WRITERS = ['cineon-backend', 'cineon-worker', 'cineon-scheduler']
SERVICES = WRITERS + ['cineon-frontend', 'cineon-redis', 'cineon-redis-cache']
AIO_STATE = Path(os.getenv('CINEON_AIO_STATE', '/var/lib/cineon-aiostreams'))
MONGO_IMAGE = os.getenv('CINEON_MONGO_TOOLS_IMAGE', 'mongo@sha256:d0d926f94df099bff534b7ee5b5986458131a22489dfff8664509af0c1e2ca9c')


def run(args, **kwargs):
    result = subprocess.run(args, capture_output=True, text=True, **kwargs)
    if result.returncode:
        # Never print command output: database tools can echo credentials.
        step = next((s for s in args if s in ('mongodump', 'mongorestore', 'node', 'redis-cli', 'mongosh')), Path(args[0]).name)
        raise RuntimeError(f'{step} failed (exit {result.returncode})')
    return result.stdout


def atomic_json(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix('.tmp')
    tmp.write_text(json.dumps(data, indent=2) + '\n')
    tmp.chmod(0o600)
    tmp.replace(path)


@contextlib.contextmanager
def ops_lock():
    STATE.mkdir(parents=True, exist_ok=True, mode=0o700)
    with open('/var/lock/cineon-production.lock', 'a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        yield


def inspect(name):
    return json.loads(run(['docker', 'inspect', name]))[0]


def probe(url):
    start = time.monotonic()
    try:
        with urllib.request.urlopen(url, timeout=8) as response:
            return response.status == 200, time.monotonic() - start
    except Exception:
        return False, time.monotonic() - start


def recovery_allowed(state, now):
    events = [t for t in state.get('restarts', []) if now - t < 3600]
    return state.get('failures', 0) >= 3 and len(events) < 3 and (
        not events or now - max(events) >= 900)


def aiostreams_enabled():
    path = ROOT / '.env'
    if not path.exists():
        return False
    return any(line.split('=', 1)[0].strip() == 'STREAM_SOURCE_PROVIDER'
               and line.split('=', 1)[1].strip().strip('\"\'') == 'aiostreams'
               for line in path.read_text().splitlines() if '=' in line)


def snapshot_aiostreams(staging):
    if not aiostreams_enabled():
        return
    target = staging / 'aiostreams'
    target.mkdir(mode=0o700)
    for name in ['.env', 'pilot-config.json', 'pilot-multi-config.json']:
        source = AIO_STATE / name
        if source.exists():
            shutil.copy2(source, target / name)
    shutil.copy2(ROOT / 'deploy/aiostreams.compose.yml', target / 'compose.yml')
    source_db = AIO_STATE / 'data/db.sqlite'
    with contextlib.closing(sqlite3.connect(source_db.resolve().as_uri() + '?mode=ro', uri=True)) as source:
        with contextlib.closing(sqlite3.connect(target / 'db.sqlite')) as destination:
            source.backup(destination)
            destination.execute('PRAGMA journal_mode=DELETE')
            destination.commit()
    verify_aiostreams_snapshot(staging)


def verify_aiostreams_snapshot(staging):
    target = staging / 'aiostreams'
    if not target.exists():
        return False
    lines = (target / '.env').read_text().splitlines()
    if not any(regex.fullmatch(r'SECRET_KEY=[0-9a-fA-F]{64}', line) for line in lines):
        raise RuntimeError('AIOStreams backup is missing its encryption key')
    with contextlib.closing(sqlite3.connect((target / 'db.sqlite').resolve().as_uri() + '?mode=ro', uri=True)) as db:
        if db.execute('PRAGMA integrity_check').fetchone()[0] != 'ok':
            raise RuntimeError('AIOStreams SQLite integrity check failed')
    return True


def monitor():
    with ops_lock():
        p = STATE / 'monitor.json'
        state = json.loads(p.read_text()) if p.exists() else {}
        now = time.time()
        metrics, problems = [], []
        aio_enabled = aiostreams_enabled()
        for name in SERVICES + (['cineon-aiostreams'] if aio_enabled else []):
            entry = state.setdefault(name, {})
            try:
                data = inspect(name)
                healthy = data['State']['Running'] and data['State'].get('Health', {}).get('Status', 'healthy') != 'unhealthy'
            except Exception:
                healthy = False
            entry['failures'] = 0 if healthy else entry.get('failures', 0) + 1
            metrics.append(f'cineon_container_up{{container="{name}"}} {int(healthy)}')
            if not healthy:
                problems.append(name)
                if recovery_allowed(entry, now):
                    run(['docker', 'restart', '--time', '30', name], timeout=60)
                    entry['restarts'] = [t for t in entry.get('restarts', []) if now - t < 3600] + [now]
                    print(f'ERROR recovered container={name}', flush=True)
        endpoints = [('api', 'http://127.0.0.1:5001/healthz'),
                           ('frontend', 'http://127.0.0.1:3000/api/health'),
                           ('public', 'https://cinevn.me/healthz')]
        if aio_enabled:
            endpoints.append(('aiostreams', 'http://127.0.0.1:3100/api/v1/status'))
        for label, url in endpoints:
            ok, elapsed = probe(url)
            metrics.extend([f'cineon_probe_up{{target="{label}"}} {int(ok)}',
                            f'cineon_probe_duration_seconds{{target="{label}"}} {elapsed:.4f}'])
            if not ok:
                problems.append(label)
        disk = shutil.disk_usage('/')
        metrics.append(f'cineon_disk_used_ratio {1-disk.free/disk.total:.5f}')
        mem = dict(line.split(':', 1) for line in Path('/proc/meminfo').read_text().splitlines())
        metrics.append(f'cineon_memory_available_bytes {int(mem["MemAvailable"].split()[0])*1024}')
        for kind in ['backup', 'restore']:
            marker = STATE / f'{kind}.json'
            record = json.loads(marker.read_text()) if marker.exists() else {}
            metrics.append(f'cineon_{kind}_last_success_timestamp_seconds {record.get("time", 0)}')
        METRICS.mkdir(parents=True, exist_ok=True)
        METRICS.chmod(0o755)
        tmp = METRICS / 'cineon.prom.tmp'
        tmp.write_text('\n'.join(metrics) + '\n')
        tmp.chmod(0o644)
        tmp.replace(METRICS / 'cineon.prom')
        atomic_json(p, state)
        print(('ERROR failures=' + ','.join(problems)) if problems else 'OK production probes')


def restic_env():
    env = os.environ.copy()
    config = STATE / 'restic.env'
    if config.exists():
        for line in config.read_text().splitlines():
            if line and not line.startswith('#') and '=' in line:
                key, value = line.split('=', 1)
                env[key] = value
    password = STATE / 'restic-password'
    if not password.exists():
        password.write_text(secrets.token_hex(32) + '\n')
        password.chmod(0o600)
    env.setdefault('RESTIC_REPOSITORY', '/var/lib/cineon-backups')
    env.setdefault('RESTIC_PASSWORD_FILE', str(password))
    env.setdefault('RESTIC_CACHE_DIR', str(STATE / 'restic-cache'))
    return env


def restic(*args):
    return run(['restic', *args], env=restic_env(), timeout=1800)


def backup():
    with ops_lock():
        data = inspect('cineon-backend')
        env = dict(s.split('=', 1) for s in data['Config']['Env'] if '=' in s)
        db = env.get('MONGODB_DB_NAME', 'movieweb')
        network = next(iter(data['NetworkSettings']['Networks']))
        if shutil.disk_usage('/').free < 2 * 1024**3:
            raise RuntimeError('Backup needs at least 2 GiB free')
        run(['docker', 'image', 'inspect', MONGO_IMAGE])
        re = restic_env()
        if re['RESTIC_REPOSITORY'].startswith('/'):
            repo = Path(re['RESTIC_REPOSITORY'])
            repo.mkdir(mode=0o700, parents=True, exist_ok=True)
            if not (repo / 'config').exists():
                restic('init')
        with tempfile.TemporaryDirectory(prefix='backup-', dir=STATE) as temp:
            staging = Path(temp)
            snapshot_aiostreams(staging)
            config = staging / 'mongo.yml'
            config.write_text('uri: ' + json.dumps(env['MONGODB_URI']) + '\n')
            config.chmod(0o600)
            nodeenv = staging / 'mongo.env'
            nodeenv.write_text('MONGODB_URI=' + env['MONGODB_URI'] + '\nMONGODB_DB_NAME=' + db + '\n')
            nodeenv.chmod(0o600)
            running = [name for name in WRITERS if inspect(name)['State']['Running']]
            try:
                run(['docker', 'stop', '--time', '40', *running], timeout=150)
                js = "import {MongoClient} from 'mongodb'; const c=new MongoClient(process.env.MONGODB_URI); await c.connect(); const d=c.db(process.env.MONGODB_DB_NAME); const m={}; for(const x of await d.listCollections({},{nameOnly:true}).toArray()){ const t=d.collection(x.name);m[x.name]={documents:await t.countDocuments(),indexes:(await t.indexes()).map(i=>i.name).sort()};} console.log(JSON.stringify(m));await c.close();"
                manifest = json.loads(run(['docker', 'run', '--rm', '--memory', '256m', '--cpus', '0.5', '--network', network,
                    '--env-file', str(nodeenv), '--entrypoint', 'node', data['Image'], '--input-type=module', '-e', js], timeout=180))
                run(['docker', 'run', '--rm', '--memory', '256m', '--cpus', '0.5', '--network', network,
                    '-v', str(staging) + ':/backup', '--entrypoint', 'mongodump', MONGO_IMAGE, '--config=/backup/mongo.yml',
                    '--db=' + db, '--archive=/backup/mongo.archive.gz', '--gzip', '--numParallelCollections=1'], timeout=600)
                run(['docker', 'exec', 'cineon-redis', 'redis-cli', 'SAVE'], timeout=30)
                run(['docker', 'cp', 'cineon-redis:/data/dump.rdb', str(staging / 'redis.rdb')])
                atomic_json(staging / 'manifest.json', {'database': db, 'collections': manifest})
                config.unlink(); nodeenv.unlink()
                for source in [ROOT / '.env', ROOT / 'docker-compose.prod.yml', Path('/etc/caddy/Caddyfile')]:
                    shutil.copy2(source, staging / source.name)
            finally:
                # Never leave writers stopped if a database dump fails.
                for name in running:
                    run(['docker', 'start', name], timeout=90)
            out = restic('backup', '--json', '--tag', 'cineon-production', str(staging))
            summary = next(json.loads(line) for line in out.splitlines() if json.loads(line).get('message_type') == 'summary')
            snapshot = summary['snapshot_id']
            restic('check')
            atomic_json(STATE / 'backup.json', {'time': time.time(), 'snapshot': snapshot, 'repository': re['RESTIC_REPOSITORY']})
            restic('forget', '--keep-daily', '7', '--keep-weekly', '4', '--keep-monthly', '3', '--tag', 'cineon-production')
            print('OK encrypted backup snapshot=' + snapshot)


def restore(snapshot='latest'):
    with ops_lock(), tempfile.TemporaryDirectory(prefix='restore-', dir=STATE) as temp:
        restic('restore', snapshot, '--tag', 'cineon-production', '--target', temp)
        stage = next(Path(temp).rglob('manifest.json')).parent
        manifest = json.loads((stage / 'manifest.json').read_text())
        name = 'cineon-restore-' + secrets.token_hex(4)
        target = 'movieweb_restore_' + secrets.token_hex(4)
        try:
            # No published ports, no outbound network, no production URI.
            run(['docker', 'run', '-d', '--name', name, '--network', 'none', '--memory', '512m', '--cpus', '0.5',
                 '--pids-limit', '128', '-v', str(stage) + ':/backup:ro', MONGO_IMAGE,
                 'mongod', '--bind_ip', '127.0.0.1', '--wiredTigerCacheSizeGB', '0.25'])
            for _ in range(30):
                try:
                    run(['docker', 'exec', name, 'mongosh', '--quiet', '--eval', 'db.adminCommand({ping:1})'], timeout=10)
                    break
                except RuntimeError:
                    time.sleep(1)
            run(['docker', 'exec', name, 'mongorestore', '--archive=/backup/mongo.archive.gz', '--gzip',
                 '--nsFrom=' + manifest['database'] + '.*', '--nsTo=' + target + '.*', '--numParallelCollections=1'], timeout=600)
            js = 'const d=db.getSiblingDB(' + json.dumps(target) + '); const m={}; for(const x of d.getCollectionNames()){const t=d.getCollection(x);m[x]={documents:t.countDocuments({}),indexes:t.getIndexes().map(i=>i.name).sort()};} print(JSON.stringify(m));'
            actual = json.loads(run(['docker', 'exec', name, 'mongosh', '--quiet', '--eval', js], timeout=120))
            if actual != manifest['collections']:
                raise RuntimeError('Restored collection counts/indexes do not match')
            run(['docker', 'run', '--rm', '--network', 'none', '--memory', '128m', '-v', str(stage) + ':/backup:ro',
                 'redis:7-alpine', 'redis-check-rdb', '/backup/redis.rdb'], timeout=60)
            if 'TOKEN_ENCRYPTION_KEYS=' not in (stage / '.env').read_text():
                raise RuntimeError('Backup is missing token encryption keys')
            restic('check', '--read-data')
            aio_verified = verify_aiostreams_snapshot(stage)
            atomic_json(STATE / 'restore.json', {'time': time.time(), 'snapshot': snapshot, 'collections': len(actual),
                         'documents': sum(v['documents'] for v in actual.values()), 'indexes_verified': True, 'redis_rdb_verified': True,
                         'aiostreams_sqlite_verified': aio_verified})
            print('OK isolated restore counts/indexes and Redis RDB verified')
        finally:
            subprocess.run(['docker', 'rm', '-f', '-v', name], capture_output=True)


def install():
    STATE.mkdir(mode=0o700, parents=True, exist_ok=True)
    STATE.chmod(0o700)
    lock = Path('/var/lock/cineon-production.lock')
    lock.touch(exist_ok=True)
    lock.chmod(0o660)
    try:
        os.chown(lock, 0, grp.getgrnam('deploy').gr_gid)
    except KeyError:
        pass
    METRICS.mkdir(parents=True, exist_ok=True)
    METRICS.chmod(0o755)
    config = Path('/etc/alloy/config.alloy')
    if config.exists() and 'directory = "/var/lib/alloy/textfile"' not in config.read_text():
        old = config.read_text()
        marker = 'prometheus.exporter.unix "integrations_node_exporter" {'
        if marker not in old:
            raise RuntimeError('Alloy unix exporter not found; configure the textfile collector')
        new = old.replace(marker, marker + '\n  textfile {\n    directory = "/var/lib/alloy/textfile"\n  }', 1)
        candidate = config.with_name('cineon-candidate.alloy')
        candidate.write_text(new)
        candidate.chmod(0o600)
        try:
            run(['alloy', 'validate', str(candidate)])
            shutil.copy2(config, STATE / 'alloy.before')
            (STATE / 'alloy.before').chmod(0o600)
            candidate.chmod(config.stat().st_mode & 0o777)
            candidate.replace(config)
            run(['systemctl', 'restart', 'alloy'])
        finally:
            candidate.unlink(missing_ok=True)
    script = ROOT / 'deploy/production_ops.py'
    for name, command, schedule in [('monitor', 'monitor', '*-*-* *:*:00'),
                                     ('backup', 'backup', '*-*-* 19:00:00 UTC'),
                                     ('restore', 'restore', 'Sun *-*-* 20:00:00 UTC')]:
        Path(f'/etc/systemd/system/cineon-{name}.service').write_text(
            '[Unit]\nDescription=CineVN ' + name + '\nAfter=docker.service network-online.target\n'
            '[Service]\nType=oneshot\nUMask=0077\nNice=10\nIOSchedulingClass=best-effort\nIOSchedulingPriority=7\n'
            'ExecStart=/usr/bin/python3 ' + str(script) + ' ' + command + '\nTimeoutStartSec=2400\n')
        Path(f'/etc/systemd/system/cineon-{name}.timer').write_text(
            '[Unit]\nDescription=CineVN ' + name + ' schedule\n[Timer]\nOnCalendar=' + schedule + '\n'
            'Persistent=true\nRandomizedDelaySec=' + ('0' if name == 'monitor' else '120') + '\n'
            '[Install]\nWantedBy=timers.target\n')
    run(['systemctl', 'daemon-reload'])
    run(['systemctl', 'enable', '--now', 'cineon-monitor.timer', 'cineon-backup.timer', 'cineon-restore.timer'])


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('command', choices=['monitor', 'backup', 'restore', 'install'])
    parser.add_argument('--snapshot', default='latest')
    args = parser.parse_args()
    try:
        if args.command == 'restore':
            restore(args.snapshot)
        else:
            globals()[args.command]()
    except BlockingIOError:
        print('SKIP another production operation holds the lock')
    except Exception as error:
        print('ERROR ' + str(error), flush=True)
        raise SystemExit(1)
