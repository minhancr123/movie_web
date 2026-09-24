import unittest
from deploy.lib.provision import provision_release

class ProvisionTest(unittest.TestCase):
    def test_ambiguous_redis_volume_is_rejected(self):
        class FakeIO:
            def check_volumes(self):
                # Simulated docker inspect output with two redis volumes
                return [
                    {'Config': {'Labels': {'com.docker.compose.service': 'redis'}},
                     'Mounts': [{'Type': 'volume', 'Name': 'redis-old', 'Destination': '/data'}]},
                    {'Config': {'Labels': {'com.docker.compose.service': 'redis'}},
                     'Mounts': [{'Type': 'volume', 'Name': 'redis-new', 'Destination': '/data'}]}
                ]
                
        with self.assertRaises(ValueError):
            provision_release({}, FakeIO())

    def test_provision_is_idempotent(self):
        class FakeIO:
            def __init__(self):
                self.calls = []
            
            def check_volumes(self):
                self.calls.append('check_volumes')
                return [
                    {'Config': {'Labels': {'com.docker.compose.service': 'redis'}},
                     'Mounts': [{'Type': 'volume', 'Name': 'redis-old', 'Destination': '/data'}]}
                ]
                
            def create_volume(self, name):
                self.calls.append(('create_volume', name))
                
            def create_directory(self, path):
                self.calls.append(('create_directory', path))

        io = FakeIO()
        provision_release({}, io)
        
        calls_first = list(io.calls)
        self.assertIn(('create_directory', '/opt/movieweb/releases'), calls_first)
        self.assertIn(('create_directory', '/opt/movieweb/incoming'), calls_first)
        self.assertIn(('create_directory', '/opt/movieweb/shared'), calls_first)
        
        # redis-old is adopted, transcodes-data is created because it's missing
        self.assertNotIn(('create_volume', 'redis-old'), calls_first)
        
        # Some volume for transcodes should be created
        transcode_creations = [c for c in calls_first if c[0] == 'create_volume' and 'transcodes' in c[1]]
        self.assertTrue(len(transcode_creations) > 0)
        
        # Second run
        io.calls = []
        provision_release({}, io)
        self.assertEqual(io.calls, calls_first, "Second run should do exactly the same checks, no extra creations")
