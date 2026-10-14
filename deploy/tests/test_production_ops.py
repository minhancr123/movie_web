import contextlib
import importlib.util
import json
import sqlite3
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('production_ops', Path(__file__).parents[1] / 'production_ops.py')
ops = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ops)


class ProductionOpsTest(unittest.TestCase):
    def test_aiostreams_snapshot_preserves_wal_commits_and_encryption_key(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp) / 'root'; state = Path(temp) / 'aio'; stage = Path(temp) / 'stage'
            (root / 'deploy').mkdir(parents=True); (state / 'data').mkdir(parents=True); stage.mkdir()
            (root / '.env').write_text('STREAM_SOURCE_PROVIDER=aiostreams\n')
            (root / 'deploy/aiostreams.compose.yml').write_text('services: {}\n')
            (state / '.env').write_text('SECRET_KEY=' + 'a' * 64 + '\n')
            (state / 'quack-config.json').write_text('{"cinevnAccountScoped": true}')
            with sqlite3.connect(state / 'data/db.sqlite') as connection:
                connection.execute('PRAGMA journal_mode=WAL')
                connection.execute('CREATE TABLE configs (name TEXT)')
                connection.execute("INSERT INTO configs VALUES ('committed-profile')")
                connection.commit()
                with patch.object(ops, 'ROOT', root), patch.object(ops, 'AIO_STATE', state):
                    ops.snapshot_aiostreams(stage)
            self.assertTrue(ops.verify_aiostreams_snapshot(stage))
            self.assertTrue(json.loads((stage / 'aiostreams/quack-config.json').read_text())['cinevnAccountScoped'])
            with sqlite3.connect(stage / 'aiostreams/db.sqlite') as restored:
                self.assertEqual(restored.execute('SELECT name FROM configs').fetchall(), [('committed-profile',)])
            (stage / 'aiostreams/.env').write_text('SECRET_KEY=missing\n')
            with self.assertRaisesRegex(RuntimeError, 'encryption key'):
                ops.verify_aiostreams_snapshot(stage)

    def test_recovery_needs_three_failures_and_has_restart_budget(self):
        self.assertFalse(ops.recovery_allowed({'failures': 2}, 10000))
        self.assertTrue(ops.recovery_allowed({'failures': 3}, 10000))
        self.assertFalse(ops.recovery_allowed({'failures': 3, 'restarts': [9900]}, 10000))
        self.assertFalse(ops.recovery_allowed({'failures': 3, 'restarts': [7000, 7500, 8000]}, 10000))
        self.assertTrue(ops.recovery_allowed({'failures': 3, 'restarts': [1000, 8000]}, 10000))

    def test_failed_dump_resumes_every_previously_running_writer(self):
        calls = []
        def fake_run(args, **kwargs):
            calls.append(args)
            if 'mongodump' in args:
                raise RuntimeError('dump failed')
            if '--input-type=module' in args:
                return json.dumps({'users': {'documents': 2, 'indexes': ['_id_']}})
            return ''
        data = {'Config': {'Env': ['MONGODB_URI=mongodb://example/test', 'MONGODB_DB_NAME=test']},
                'NetworkSettings': {'Networks': {'private': {}}}, 'Image': 'backend', 'State': {'Running': True}}
        with tempfile.TemporaryDirectory() as temp, \
             patch.object(ops, 'STATE', Path(temp)), \
             patch.object(ops, 'ops_lock', contextlib.nullcontext), \
             patch.object(ops, 'inspect', return_value=data), \
             patch.object(ops, 'restic_env', return_value={'RESTIC_REPOSITORY': 'sftp:test'}), \
             patch.object(ops, 'run', side_effect=fake_run):
            with self.assertRaisesRegex(RuntimeError, 'dump failed'):
                ops.backup()
        started = [args[-1] for args in calls if args[:2] == ['docker', 'start']]
        self.assertEqual(started, ops.WRITERS)

    def test_ops_cli_does_not_disclose_failed_command_output(self):
        from subprocess import CompletedProcess
        with patch.object(ops.subprocess, 'run', return_value=CompletedProcess([], 1, '', 'password=secret')):
            with self.assertRaisesRegex(RuntimeError, '^mongodump failed') as error:
                ops.run(['mongodump'])
        self.assertNotIn('secret', str(error.exception))

    def test_restore_is_isolated_from_production_network(self):
        source = Path(spec.origin).read_text()
        restore = source.split('def restore(')[1].split('def install(')[0]
        self.assertIn("'--network', 'none'", restore)
        self.assertIn("'--nsTo=' + target", restore)
        self.assertNotIn('MONGODB_URI', restore)
