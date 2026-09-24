import hashlib
import os
import tempfile
import unittest
import zipfile
from pathlib import Path
from tools.build_deploy_package import build_package, verify_package

class PackageTest(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory(prefix='cineon-package-')
        self.d = Path(self.temp_dir.name)
        
    def tearDown(self):
        self.temp_dir.cleanup()

    def test_env_secret_entry_is_rejected(self):
        p = self.d / 'bad.zip'
        with zipfile.ZipFile(p, 'w') as z:
            z.writestr('kit/.env', 'TOKEN=fixture')
            z.writestr('docs/cineon-deployment/CINEON_DEPLOY_A_Z.md', 'content')
            
        expected = {
            'kit/.env': hashlib.sha256(b'TOKEN=fixture').hexdigest(),
            'docs/cineon-deployment/CINEON_DEPLOY_A_Z.md': hashlib.sha256(b'content').hexdigest()
        }
        with self.assertRaisesRegex(ValueError, 'secret entry rejected'):
            verify_package(p, expected)
            
    def test_path_traversal_rejected(self):
        p = self.d / 'bad.zip'
        with zipfile.ZipFile(p, 'w') as z:
            z.writestr('../etc/passwd', 'root:x:0:0:')
            z.writestr('docs/cineon-deployment/CINEON_DEPLOY_A_Z.md', 'content')
            
        expected = {
            '../etc/passwd': hashlib.sha256(b'root:x:0:0:').hexdigest(),
            'docs/cineon-deployment/CINEON_DEPLOY_A_Z.md': hashlib.sha256(b'content').hexdigest()
        }
        with self.assertRaisesRegex(ValueError, 'path traversal rejected'):
            verify_package(p, expected)
            
    def test_wrong_checksum_rejected(self):
        p = self.d / 'bad.zip'
        with zipfile.ZipFile(p, 'w') as z:
            z.writestr('docs/cineon-deployment/CINEON_DEPLOY_A_Z.md', 'content')
            
        expected = {
            'docs/cineon-deployment/CINEON_DEPLOY_A_Z.md': 'wronghash'
        }
        with self.assertRaisesRegex(ValueError, 'checksum mismatch'):
            verify_package(p, expected)
            
    def test_duplicate_entry_rejected(self):
        p = self.d / 'bad.zip'
        with zipfile.ZipFile(p, 'w') as z:
            z.writestr('docs/cineon-deployment/CINEON_DEPLOY_A_Z.md', 'content1')
        with zipfile.ZipFile(p, 'a') as z:
            z.writestr('docs/cineon-deployment/CINEON_DEPLOY_A_Z.md', 'content2')
            
        expected = {
            'docs/cineon-deployment/CINEON_DEPLOY_A_Z.md': hashlib.sha256(b'content1').hexdigest()
        }
        with self.assertRaisesRegex(ValueError, 'duplicate entry rejected'):
            verify_package(p, expected)
            
    def test_missing_main_document_rejected(self):
        p = self.d / 'bad.zip'
        with zipfile.ZipFile(p, 'w') as z:
            z.writestr('some_file.txt', 'content')
            
        expected = {
            'some_file.txt': hashlib.sha256(b'content').hexdigest()
        }
        with self.assertRaisesRegex(ValueError, 'missing main document rejected'):
            verify_package(p, expected)
            
    def test_valid_package_accepted(self):
        p = self.d / 'good.zip'
        with zipfile.ZipFile(p, 'w') as z:
            z.writestr('docs/cineon-deployment/CINEON_DEPLOY_A_Z.md', 'content')
            z.writestr('.env.prod.example', 'example')
            
        expected = {
            'docs/cineon-deployment/CINEON_DEPLOY_A_Z.md': hashlib.sha256(b'content').hexdigest(),
            '.env.prod.example': hashlib.sha256(b'example').hexdigest()
        }
        # Should not raise
        verify_package(p, expected)

if __name__ == '__main__':
    unittest.main()
