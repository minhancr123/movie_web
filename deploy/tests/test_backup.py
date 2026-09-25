"""Tests for backup orchestration and restore validation."""

import unittest
from types import SimpleNamespace
from contextlib import nullcontext
from deploy.lib.backup import run_backup


class BackupTest(unittest.TestCase):

    def _make_io(self, **overrides):
        """Create a fake BackupIO with configurable methods."""
        events = []
        defaults = dict(
            lock=nullcontext,
            preflight=lambda: None,
            database_name="movieweb",
            running_services=lambda: ["backend-node"],
            maintenance_state=lambda: False,
            maintenance=lambda on: events.append(("maintenance", on)),
            stop_writers=lambda s: events.append(("stop", s)),
            capture=lambda db: "/tmp/staging/backup-001",
            resume=lambda s: events.append(("resume", s)),
            publish=lambda staging, metadata: "snapshot-001",
            verify_snapshot=lambda sid: None,
            mark_success=lambda sid: events.append(("success", sid)),
            notify=lambda msg, error=False: None,
        )
        defaults.update(overrides)
        return SimpleNamespace(**defaults), events

    def test_dump_failure_resumes_original_services(self):
        """When capture fails, services must be resumed and maintenance cleared."""
        def fail(db):
            raise RuntimeError("dump failed")

        io, events = self._make_io(capture=fail)
        with self.assertRaisesRegex(RuntimeError, "dump failed"):
            run_backup(io)
        self.assertIn(("resume", ["backend-node"]), events)
        self.assertEqual(events[-1], ("maintenance", False))

    def test_happy_path_returns_snapshot(self):
        """A successful backup returns the snapshot ID."""
        io, events = self._make_io()
        result = run_backup(io)
        self.assertEqual(result, "snapshot-001")
        self.assertIn(("success", "snapshot-001"), events)

    def test_maintenance_is_restored_on_failure(self):
        """If we were already in maintenance, stay in maintenance on failure."""
        def fail(db):
            raise RuntimeError("boom")

        io, events = self._make_io(
            maintenance_state=lambda: True,
            capture=fail,
        )
        with self.assertRaises(RuntimeError):
            run_backup(io)
        # Should restore to True (was_maintenance)
        self.assertEqual(events[-1], ("maintenance", True))

    def test_mark_success_not_called_on_verify_failure(self):
        """If verify_snapshot fails, mark_success must not be called."""
        def fail_verify(sid):
            raise RuntimeError("verification failed")

        io, events = self._make_io(verify_snapshot=fail_verify)
        with self.assertRaises(RuntimeError):
            run_backup(io)
        self.assertFalse(any(e[0] == "success" for e in events))

    def test_services_resumed_even_with_multiple_running(self):
        """All originally running services must be resumed."""
        services = ["backend-node", "worker", "scheduler"]
        io, events = self._make_io(
            running_services=lambda: services,
        )
        run_backup(io)
        self.assertIn(("resume", services), events)

    def test_preflight_failure_prevents_backup(self):
        """Preflight failure should abort before stopping any services."""
        def fail_pre():
            raise RuntimeError("disk full")

        io, events = self._make_io(preflight=fail_pre)
        with self.assertRaises(RuntimeError):
            run_backup(io)
        self.assertFalse(any(e[0] == "stop" for e in events))
        self.assertFalse(any(e[0] == "resume" for e in events))

    def test_capture_receives_database_name(self):
        """capture() must receive the configured database name, not hardcoded."""
        captured_db = []
        io, events = self._make_io(
            database_name="cineon_prod",
            capture=lambda db: (captured_db.append(db), "/tmp/staging")[1],
        )
        run_backup(io)
        self.assertEqual(captured_db, ["cineon_prod"])

    def test_publish_receives_metadata_with_db_name(self):
        """publish() must receive metadata containing the database namespace."""
        published = []
        io, events = self._make_io(
            database_name="cineon_prod",
            publish=lambda staging, metadata: (published.append(metadata), "snap-1")[1],
        )
        run_backup(io)
        self.assertEqual(published[0]["database_name"], "cineon_prod")

    def test_missing_database_name_raises(self):
        """Backup must refuse to run if database_name is empty."""
        io, events = self._make_io(database_name="")
        with self.assertRaises(ValueError):
            run_backup(io)

    def test_non_default_database_name_works(self):
        """Backup with a non-default DB name must pass it through correctly."""
        captured_db = []
        io, events = self._make_io(
            database_name="my_custom_db",
            capture=lambda db: (captured_db.append(db), "/tmp/staging")[1],
        )
        run_backup(io)
        self.assertEqual(captured_db, ["my_custom_db"])


class RestoreTest(unittest.TestCase):

    def test_production_or_path_is_rejected(self):
        from deploy.lib.restore import validate_restore_target
        for name in ["movieweb", "../movieweb", "movieweb_restore_", "admin"]:
            with self.assertRaises(ValueError):
                validate_restore_target(name, "movieweb")

    def test_valid_restore_target_accepted(self):
        from deploy.lib.restore import validate_restore_target
        result = validate_restore_target("movieweb_restore_drill_1", "movieweb")
        self.assertEqual(result, "movieweb_restore_drill_1")

    def test_empty_target_rejected(self):
        from deploy.lib.restore import validate_restore_target
        with self.assertRaises(ValueError):
            validate_restore_target("", "movieweb")

    def test_target_matching_production_rejected(self):
        from deploy.lib.restore import validate_restore_target
        with self.assertRaises(ValueError):
            validate_restore_target("movieweb", "movieweb")

    def test_uppercase_target_rejected(self):
        from deploy.lib.restore import validate_restore_target
        with self.assertRaises(ValueError):
            validate_restore_target("movieweb_restore_DRILL", "movieweb")


if __name__ == "__main__":
    unittest.main()
