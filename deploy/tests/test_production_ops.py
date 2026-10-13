import contextlib
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('production_ops', Path(__file__).parents[1] / 'production_ops.py')
ops = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ops)


class ProductionOpsTest(unittest.TestCase):
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
