import unittest
from contextlib import nullcontext
from deploy.lib.deploy import deploy_release, DeploymentFailed
from deploy.tests.support import make_release

class TransactionTest(unittest.TestCase):
    def test_bad_frontend_restores_whole_release(self):
        old, new = make_release('a'), make_release('b')
        events = []
        
        class IO:
            def lock(self): return nullcontext()
            def current(self): return old
            def preflight(self, r): return None
            def pull(self, r): return None
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
        new = make_release('b')
        events = []
        
        class IO:
            def lock(self): return nullcontext()
            def current(self): return None
            def preflight(self, r): return None
            def pull(self, r): return None
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
