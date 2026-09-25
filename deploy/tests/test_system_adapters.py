import unittest
from unittest.mock import patch
from deploy.lib.deploy_system import ComposeDeployIO
from deploy.lib.backup_system import SystemBackupIO

class TestSystemAdapters(unittest.TestCase):
    @patch('subprocess.run')
    def test_compose_deploy_pull(self, mock_run):
        io = ComposeDeployIO('docker-compose.yml', 'cineon')
        io.pull({'version': '1.0'})
        mock_run.assert_called_with(['docker', 'compose', '-f', 'docker-compose.yml', '-p', 'cineon', 'pull'], check=True)

    @patch('subprocess.run')
    def test_backup_capture(self, mock_run):
        config = {'database_name': 'test_db', 'mongo_config_path': '/etc/mongodump.conf', 'redis_cli': 'redis-cli'}
        io = SystemBackupIO(config)
        io.capture('test_db')
        mock_run.assert_any_call(['mongodump', '--config=/etc/mongodump.conf', '--db', 'test_db', '--out', '/tmp/dump'], check=True)
        mock_run.assert_any_call(['redis-cli', 'SAVE'], check=True)

if __name__ == '__main__':
    unittest.main()
