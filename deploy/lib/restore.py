"""Restore target validation and drill orchestration."""

import re


def validate_restore_target(target: str, production_db: str) -> str:
    """Validate that a restore target is safe.

    Args:
        target: Database name to restore into
        production_db: Name of the production database (must be different)

    Returns:
        The validated target name

    Raises:
        ValueError if target is production, traversal, or doesn't match pattern
    """
    if not target or target == production_db:
        raise ValueError("invalid restore target")
    if not re.fullmatch(r"movieweb_restore_[a-z0-9_-]+", target):
        raise ValueError("invalid restore target")
    return target


def restore_drill(snapshot, target, io):
    """Execute a restore drill against an isolated target.

    Args:
        snapshot: Snapshot ID to restore from
        target: Validated restore target database name
        io: RestoreDrillIO adapter with methods:
            fetch_snapshot(snapshot_id) -> staging_path
            restore_mongo(staging, target_db) -> {collections, documents}
            restore_redis(staging) -> {keys}
            verify_health(target_db) -> {status, release}
            verify_auth(target_db) -> {users, sessions}
            verify_decrypt(staging, keyring) -> {tokens_decrypted}
            cleanup(drill_id)

    Returns:
        dict with: {counts, indexes, key_decrypt, health, queue, elapsed}
    """
    import time
    start = time.monotonic()

    staging = io.fetch_snapshot(snapshot)
    mongo_result = io.restore_mongo(staging, target)
    redis_result = io.restore_redis(staging)
    health = io.verify_health(target)
    auth = io.verify_auth(target)
    decrypt = io.verify_decrypt(staging, io.keyring)

    elapsed = time.monotonic() - start

    return {
        "snapshot": snapshot,
        "target": target,
        "counts": mongo_result,
        "redis_keys": redis_result.get("keys", 0),
        "health": health,
        "auth": auth,
        "key_decrypt": decrypt,
        "elapsed_seconds": round(elapsed, 2),
    }
