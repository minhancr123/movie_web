"""Backup orchestration with recovery-first flow.

Ensures consistent backups by:
1. Taking an ops lock (prevents concurrent backup/deploy)
2. Entering maintenance mode
3. Stopping writers (app services)
4. Capturing data (mongodump + Redis RDB)
5. Resuming services ASAP
6. Publishing encrypted offsite (restic)
7. Verifying the snapshot

The database name comes from io.database_name (configured via MONGODB_DB_NAME)
instead of being hardcoded. The snapshot metadata records the namespace so
restore can validate compatibility (P1 fix).
"""

from contextlib import contextmanager


def run_backup(io):
    """Execute a full backup cycle.

    Args:
        io: BackupIO adapter with methods:
            lock() -> context manager for ops lock
            preflight() -> validates prerequisites
            database_name -> str, validated production DB name
            running_services() -> list of running service names
            maintenance_state() -> bool, current maintenance mode
            maintenance(on: bool) -> set maintenance mode
            stop_writers(services: list) -> stop listed services
            capture(database_name: str) -> returns private staging path
            resume(services: list) -> restart listed services
            publish(staging_path: str, metadata: dict) -> returns snapshot ID
            verify_snapshot(snapshot_id: str) -> raises on failure
            mark_success(snapshot_id: str) -> records success marker
            notify(message: str, error: bool) -> optional notification

    Returns:
        snapshot_id: str

    Raises:
        RuntimeError on any backup failure (services are always resumed)
    """
    db_name = io.database_name
    if not db_name or not isinstance(db_name, str):
        raise ValueError("io.database_name must be a non-empty string")

    with io.lock():
        io.preflight()
        running = io.running_services()
        was_maintenance = io.maintenance_state()
        try:
            io.maintenance(True)
            io.stop_writers(running)
            staging = io.capture(db_name)
        except Exception:
            # Always resume on capture failure — this is the critical path
            io.resume(running)
            io.maintenance(was_maintenance)
            raise
        # Resume ASAP after capture, before the slow publish step
        io.resume(running)
        io.maintenance(was_maintenance)

    # Publish with namespace metadata so restore can validate
    metadata = {"database_name": db_name}
    snapshot = io.publish(staging, metadata)
    io.verify_snapshot(snapshot)
    io.mark_success(snapshot)
    return snapshot
