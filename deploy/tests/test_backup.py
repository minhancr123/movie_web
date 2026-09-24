"""Tests for backup orchestration."""

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
            running_services=lambda: ["backend-node"],
            maintenance_state=lambda: False,
            maintenance=lambda on: events.append(("maintenance", on)),
            stop_writers=lambda s: events.append(("stop", s)),
            capture=lambda: "/tmp/staging/backup-001",
            resume=lambda s: events.append(("resume", s)),
            publish=lambda staging: "snapshot-001",
            verify_snapshot=lambda sid: None,
            mark_success=lambda sid: events.append(("success", sid)),
            notify=lambda msg, error=False: None,
        )
        defaults.update(overrides)
        return SimpleNamespace(**defaults), events

    def test_dump_failure_resumes_original_services(self):
        """When capture fails, services must be resumed and maintenance cleared."""
        def fail():
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
        def fail():
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
        # mark_success should not be in events
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
        # No stop or resume should have happened
        self.assertFalse(any(e[0] == "stop" for e in events))
        self.assertFalse(any(e[0] == "resume" for e in events))


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
