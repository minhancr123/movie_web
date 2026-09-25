import unittest
from contextlib import nullcontext
from deploy.lib.deploy import deploy_release, DeploymentFailed


class TransactionTest(unittest.TestCase):
    def test_bad_frontend_restores_whole_release(self):
        from deploy.tests.support import make_release
        old, new = make_release('a'), make_release('b')
        events = []

        class IO:
            def lock(self): return nullcontext()
            def current(self): return old
            def preflight(self, r): return None
            def pull(self, r): return None
            def maintenance_state(self): return False
            def maintenance(self, on): events.append(('maintenance', on))
            def apply(self, r): events.append(('apply', r['releaseId']))
            def verify(self, r):
                if r == new: raise RuntimeError('frontend release mismatch')
            def restore_current(self, r): events.append(('restored', r['releaseId'] if r else None))
            def commit(self, r, p): events.append(('commit', r['releaseId']))
            def notify(self, event): events.append(('notify', event))
            def stop_candidate(self): events.append('stop_candidate')

        with self.assertRaises(DeploymentFailed):
            deploy_release(new, IO())

        self.assertIn(('apply', old['releaseId']), events)
        self.assertNotIn(('commit', new['releaseId']), events)
        self.assertIn(('notify', 'deploy_failed'), events)

    def test_first_install_rollback(self):
        from deploy.tests.support import make_release
        new = make_release('b')
        events = []

        class IO:
            def lock(self): return nullcontext()
            def current(self): return None
            def preflight(self, r): return None
            def pull(self, r): return None
            def maintenance_state(self): return False
            def maintenance(self, on): events.append(('maintenance', on))
            def apply(self, r): events.append(('apply', r['releaseId']))
            def verify(self, r):
                raise RuntimeError('fail')
            def restore_current(self, r): events.append(('restored', r))
            def commit(self, r, p): events.append(('commit', r['releaseId']))
            def notify(self, event): events.append(('notify', event))
            def stop_candidate(self): events.append('stop_candidate')

        with self.assertRaises(DeploymentFailed):
            deploy_release(new, IO())

        self.assertIn('stop_candidate', events)
        self.assertIn(('restored', None), events)

    def test_maintenance_timeout_does_not_leave_site_stuck(self):
        """P1 regression: maintenance(True) inside try ensures recovery on timeout."""
        from deploy.tests.support import make_release
        old, new = make_release('a'), make_release('b')
        events = []

        class IO:
            def lock(self): return nullcontext()
            def current(self): return old
            def preflight(self, r): return None
            def pull(self, r): return None
            def maintenance_state(self): return False
            def maintenance(self, on):
                events.append(('maintenance', on))
                if on and len([e for e in events if e == ('maintenance', True)]) == 1:
                    # First maintenance(True) call — simulate timeout
                    raise TimeoutError('caddy maintenance timeout')
            def apply(self, r): events.append(('apply', r['releaseId']))
            def verify(self, r): return None
            def restore_current(self, r): events.append(('restored', r['releaseId'] if r else None))
            def commit(self, r, p): events.append(('commit', r['releaseId']))
            def notify(self, event): events.append(('notify', event))
            def stop_candidate(self): events.append('stop_candidate')

        with self.assertRaises(DeploymentFailed):
            deploy_release(new, IO())

        # The deploy_failed notification must have been sent
        self.assertIn(('notify', 'deploy_failed'), events)
        # Original release must have been restored
        self.assertIn(('restored', old['releaseId']), events)

    def test_rollback_restores_original_maintenance_state(self):
        """P1: When rollback completes, maintenance goes back to was_maintenance."""
        from deploy.tests.support import make_release
        old, new = make_release('a'), make_release('b')
        events = []

        class IO:
            def lock(self): return nullcontext()
            def current(self): return old
            def preflight(self, r): return None
            def pull(self, r): return None
            def maintenance_state(self): return False
            def maintenance(self, on): events.append(('maintenance', on))
            def apply(self, r):
                events.append(('apply', r['releaseId']))
                if r == new: raise RuntimeError('apply failed')
            def verify(self, r): return None
            def restore_current(self, r): events.append(('restored', r['releaseId'] if r else None))
            def commit(self, r, p): events.append(('commit', r['releaseId']))
            def notify(self, event): events.append(('notify', event))
            def stop_candidate(self): events.append('stop_candidate')

        with self.assertRaises(DeploymentFailed):
            deploy_release(new, IO())

        # After rollback, maintenance should be restored to was_maintenance (False)
        maintenance_events = [e for e in events if e[0] == 'maintenance']
        # Last maintenance call should restore to original state
        self.assertEqual(maintenance_events[-1], ('maintenance', False))


if __name__ == "__main__":
    unittest.main()
