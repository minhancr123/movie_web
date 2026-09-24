import unittest
from deploy.lib.acceptance import assert_complete

class AcceptanceReportTest(unittest.TestCase):
    def test_mock_cannot_satisfy_live_cdn(self):
        rows=[{'id':'A07','environment':'local','status':'passed','evidencePath':'fixture.txt'}]
        with self.assertRaises(ValueError) as ctx: 
            assert_complete(rows,{'A07':'production'})
        self.assertIn("cannot satisfy", str(ctx.exception))

    def test_missing_id_fails(self):
        rows = [{'id': 'A01', 'environment': 'production', 'status': 'passed'}]
        with self.assertRaises(ValueError) as ctx:
            assert_complete(rows, {'A01': 'production', 'A02': 'production'})
        self.assertIn("Requirement A02 missing", str(ctx.exception))

    def test_failed_status_fails(self):
        rows = [{'id': 'A01', 'environment': 'production', 'status': 'failed'}]
        with self.assertRaises(ValueError) as ctx:
            assert_complete(rows, {'A01': 'production'})
        self.assertIn("failed or unverified", str(ctx.exception))

    def test_unverified_status_fails(self):
        rows = [{'id': 'A01', 'environment': 'production', 'status': 'unverified'}]
        with self.assertRaises(ValueError) as ctx:
            assert_complete(rows, {'A01': 'production'})
        self.assertIn("failed or unverified", str(ctx.exception))

    def test_stale_release_fails(self):
        rows = [{'id': 'A01', 'environment': 'production', 'status': 'passed', 'release': 'v1.0.0'}]
        with self.assertRaises(ValueError) as ctx:
            assert_complete(rows, {'A01': 'production'}, expected_release='v1.0.1')
        self.assertIn("stale release", str(ctx.exception))

    def test_all_passed_succeeds(self):
        rows = [
            {'id': 'A01', 'environment': 'production', 'status': 'passed', 'release': 'v1.0.1'},
            {'id': 'A02', 'environment': 'staging', 'status': 'passed', 'release': 'v1.0.1'}
        ]
        # Should not raise exception
        assert_complete(rows, {'A01': 'production', 'A02': 'staging'}, expected_release='v1.0.1')
