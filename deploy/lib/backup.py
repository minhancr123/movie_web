"""Backup orchestration with recovery-first flow.

Ensures consistent backups by:
1. Taking an ops lock (prevents concurrent backup/deploy)
2. Entering maintenance mode
3. Stopping writers (app services)
4. Capturing data (mongodump + Redis RDB)
5. Resuming services ASAP
6. Publishing encrypted offsite (restic)
7. Verifying the snapshot
"""

from contextlib import contextmanager


def run_backup(io):
    """Execute a full backup cycle.

    Args:
        io: BackupIO adapter with methods:
            lock() -> context manager for ops lock
            preflight() -> validates prerequisites
            running_services() -> list of running service names
            maintenance_state() -> bool, current maintenance mode
            maintenance(on: bool) -> set maintenance mode
            stop_writers(services: list) -> stop listed services
            capture() -> returns private staging path
            resume(services: list) -> restart listed services
            publish(staging_path: str) -> returns snapshot ID
            verify_snapshot(snapshot_id: str) -> raises on failure
            mark_success(snapshot_id: str) -> records success marker
            notify(message: str, error: bool) -> optional notification

    Returns:
        snapshot_id: str

    Raises:
        RuntimeError on any backup failure (services are always resumed)
    """
    with io.lock():
        io.preflight()
        running = io.running_services()
        was_maintenance = io.maintenance_state()
        try:
            io.maintenance(True)
            io.stop_writers(running)
            staging = io.capture()
        except Exception:
            # Always resume on capture failure — this is the critical path
            io.resume(running)
            io.maintenance(was_maintenance)
            raise
        # Resume ASAP after capture, before the slow publish step
        io.resume(running)
        io.maintenance(was_maintenance)

    # Publish and verify happen after services are back up
    snapshot = io.publish(staging)
    io.verify_snapshot(snapshot)
    io.mark_success(snapshot)
    return snapshot
