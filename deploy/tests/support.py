"""Test helpers for deploy module tests.

Provides factories for release manifests and bundles with reproducible fixtures.
"""

import hashlib
import json
import os
import tarfile
import tempfile
from datetime import datetime, timezone
from pathlib import Path


def make_release(seed: str = "a") -> dict:
    """Create a valid release manifest with fixture data derived from seed."""
    release_id = seed * 40
    return {
        "schemaVersion": 1,
        "releaseId": release_id[:40],
        "commitSha": release_id[:40],
        "images": {
            "backend": f"example/backend@sha256:{seed * 64}",
            "frontend": f"example/frontend@sha256:{'b' * 64}",
        },
        "files": {},
        "configVersion": 1,
        "databaseCompatibility": "backward-compatible",
        "createdAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "tests": {
            "lint": "passed",
            "typecheck": "passed",
            "unit": "passed",
            "build": "passed",
        },
    }


def make_bundle(tmp_path: Path, release: dict = None, extra_files: dict = None) -> Path:
    """Create a tar.gz bundle from a release manifest and optional extra files.

    Returns the path to the created bundle file.
    extra_files: dict of {arcname: content_bytes}
    """
    if release is None:
        release = make_release()

    bundle_path = tmp_path / "release.tar.gz"

    with tarfile.open(bundle_path, "w:gz") as tar:
        # Add manifest
        manifest_bytes = json.dumps(release, indent=2).encode("utf-8")
        _add_bytes(tar, "manifest.json", manifest_bytes)

        # Add any files referenced in the release
        for rel_path, expected_hash in release.get("files", {}).items():
            # Create content that matches the hash
            content = f"fixture-content-{rel_path}".encode("utf-8")
            actual_hash = hashlib.sha256(content).hexdigest()
            release["files"][rel_path] = actual_hash
            _add_bytes(tar, rel_path, content)

        # Add extra files
        if extra_files:
            for arcname, content in extra_files.items():
                if isinstance(content, str):
                    content = content.encode("utf-8")
                _add_bytes(tar, arcname, content)

    return bundle_path


def _add_bytes(tar: tarfile.TarFile, name: str, data: bytes):
    """Add bytes as a regular file to a tarfile."""
    import io
    info = tarfile.TarInfo(name=name)
    info.size = len(data)
    tar.addfile(info, io.BytesIO(data))
