"""Release manifest validation.

Validates manifest schema before any extraction or deployment.
Rejects path traversal, missing digests, unknown schemas, and forbidden members.
"""

import re
import json
import hashlib
from pathlib import PurePosixPath

SCHEMA_VERSION = 1
CONFIG_VERSION = 1
DB_COMPAT_VALUES = frozenset({"backward-compatible"})

# Pattern for a docker image reference with digest
_DIGEST_RE = re.compile(r"^[\w./-]+@sha256:[0-9a-f]{64}$")
# Pattern for a 40-char hex SHA
_SHA_RE = re.compile(r"^[0-9a-f]{40}$")
# Pattern for SHA256 file hash
_HASH_RE = re.compile(r"^[0-9a-f]{64}$")
# ISO 8601 UTC timestamp pattern
_ISO_RE = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$")

_FORBIDDEN_NAMES = frozenset({".env", "app.env", ".git", "id_rsa", "id_ed25519"})

_KNOWN_FIELDS = frozenset({
    "schemaVersion", "releaseId", "commitSha", "images", "files",
    "configVersion", "databaseCompatibility", "createdAt", "tests",
})
_IMAGE_FIELDS = frozenset({"backend", "frontend"})
_REQUIRED_TESTS = frozenset({"lint", "typecheck", "unit", "build"})


def validate_member(name: str) -> PurePosixPath:
    """Validate a bundle member path. Raises ValueError for invalid paths."""
    p = PurePosixPath(name)
    if not name or "\\" in name or ":" in name or p.is_absolute() or ".." in p.parts:
        raise ValueError("invalid bundle member")
    if name != str(p) or name.startswith("./"):
        raise ValueError("noncanonical bundle member")
    if any(x in _FORBIDDEN_NAMES for x in p.parts):
        raise ValueError("forbidden bundle member")
    return p


def validate_manifest(data: dict) -> dict:
    """Validate a release manifest dict. Returns the validated data or raises ValueError."""
    if not isinstance(data, dict):
        raise ValueError("manifest must be a dict")

    # Reject unknown fields
    unknown = set(data.keys()) - _KNOWN_FIELDS
    if unknown:
        raise ValueError(f"unknown manifest fields: {', '.join(sorted(unknown))}")

    # Schema version
    if data.get("schemaVersion") != SCHEMA_VERSION:
        raise ValueError(f"unsupported schemaVersion: {data.get('schemaVersion')}")

    # Release ID
    release_id = data.get("releaseId", "")
    if not _SHA_RE.match(release_id):
        raise ValueError("releaseId must be 40 hex chars")

    # Commit SHA must match release ID
    if data.get("commitSha") != release_id:
        raise ValueError("commitSha must equal releaseId")

    # Images
    images = data.get("images", {})
    if not isinstance(images, dict) or set(images.keys()) != _IMAGE_FIELDS:
        raise ValueError("images must have exactly 'backend' and 'frontend'")
    for key, ref in images.items():
        if not _DIGEST_RE.match(ref):
            raise ValueError(f"images.{key} must be a digest reference (registry/name@sha256:hex64)")

    # Files
    files = data.get("files", {})
    if not isinstance(files, dict):
        raise ValueError("files must be a dict")
    for path, hash_val in files.items():
        validate_member(path)
        if not _HASH_RE.match(hash_val):
            raise ValueError(f"files[{path}] must be a SHA256 hex hash")

    # Config version
    if data.get("configVersion") != CONFIG_VERSION:
        raise ValueError(f"unsupported configVersion: {data.get('configVersion')}")

    # Database compatibility
    db_compat = data.get("databaseCompatibility", "")
    if db_compat not in DB_COMPAT_VALUES:
        raise ValueError(f"invalid databaseCompatibility: {db_compat}")

    # Timestamp
    created_at = data.get("createdAt", "")
    if not _ISO_RE.match(created_at):
        raise ValueError("createdAt must be ISO 8601 UTC")

    # Tests
    tests = data.get("tests", {})
    if not isinstance(tests, dict):
        raise ValueError("tests must be a dict")
    for gate, status in tests.items():
        if status != "passed":
            raise ValueError(f"test gate '{gate}' is not passed: {status}")

    return data
