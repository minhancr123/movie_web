"""Tests for release manifest validation."""

import unittest
from deploy.lib.manifest import validate_manifest, validate_member
from deploy.tests.support import make_release


class ManifestValidationTest(unittest.TestCase):
    """Test manifest schema validation."""

    def test_valid_manifest_accepted(self):
        r = make_release()
        result = validate_manifest(r)
        self.assertEqual(result["releaseId"], "a" * 40)

    def test_rejects_escape_before_extract(self):
        r = make_release()
        r["files"]["../shared/app.env"] = "c" * 64
        with self.assertRaises(ValueError):
            validate_manifest(r)

    def test_requires_digest(self):
        r = make_release()
        r["images"]["backend"] = "example/app:latest"
        with self.assertRaises(ValueError):
            validate_manifest(r)

    def test_rejects_unknown_fields(self):
        r = make_release()
        r["extraField"] = "surprise"
        with self.assertRaises(ValueError):
            validate_manifest(r)

    def test_rejects_wrong_schema_version(self):
        r = make_release()
        r["schemaVersion"] = 99
        with self.assertRaises(ValueError):
            validate_manifest(r)

    def test_rejects_short_release_id(self):
        r = make_release()
        r["releaseId"] = "abc"
        with self.assertRaises(ValueError):
            validate_manifest(r)

    def test_rejects_commit_mismatch(self):
        r = make_release()
        r["commitSha"] = "b" * 40
        with self.assertRaises(ValueError):
            validate_manifest(r)

    def test_rejects_failed_test_gate(self):
        r = make_release()
        r["tests"]["unit"] = "failed"
        with self.assertRaises(ValueError):
            validate_manifest(r)

    def test_rejects_invalid_db_compat(self):
        r = make_release()
        r["databaseCompatibility"] = "breaking"
        with self.assertRaises(ValueError):
            validate_manifest(r)

    def test_rejects_invalid_timestamp(self):
        r = make_release()
        r["createdAt"] = "not-a-date"
        with self.assertRaises(ValueError):
            validate_manifest(r)

    def test_rejects_non_hex_file_hash(self):
        r = make_release()
        r["files"]["config.yml"] = "not-a-hash"
        with self.assertRaises(ValueError):
            validate_manifest(r)


class MemberValidationTest(unittest.TestCase):
    """Test bundle member path validation."""

    def test_valid_path(self):
        p = validate_member("deploy/Caddyfile")
        self.assertEqual(str(p), "deploy/Caddyfile")

    def test_rejects_traversal(self):
        with self.assertRaises(ValueError):
            validate_member("../etc/passwd")

    def test_rejects_absolute(self):
        with self.assertRaises(ValueError):
            validate_member("/etc/passwd")

    def test_rejects_backslash(self):
        with self.assertRaises(ValueError):
            validate_member("deploy\\Caddyfile")

    def test_rejects_env_file(self):
        with self.assertRaises(ValueError):
            validate_member("shared/.env")

    def test_rejects_ssh_key(self):
        with self.assertRaises(ValueError):
            validate_member("keys/id_rsa")

    def test_rejects_dotdot_component(self):
        with self.assertRaises(ValueError):
            validate_member("a/../b")

    def test_rejects_colon(self):
        with self.assertRaises(ValueError):
            validate_member("C:file")

    def test_rejects_dot_prefix(self):
        with self.assertRaises(ValueError):
            validate_member("./relative")

    def test_rejects_empty(self):
        with self.assertRaises(ValueError):
            validate_member("")


if __name__ == "__main__":
    unittest.main()
