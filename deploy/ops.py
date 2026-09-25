import argparse
import sys
import os
from lib.deploy_system import ComposeDeployIO
from lib.backup_system import SystemBackupIO
from lib.deploy import deploy_release
from lib.backup import run_backup
from lib.restore import restore_drill
from lib.provision import provision_release

def main():
    parser = argparse.ArgumentParser(description="Cineon DevOps CLI")
    subparsers = parser.add_subparsers(dest='command', required=True)

    prov_parser = subparsers.add_parser('provision', help='Provision a new release')
    prov_parser.add_argument('--release', required=True)

    dep_parser = subparsers.add_parser('deploy', help='Deploy a release (with automatic rollback on failure)')
    dep_parser.add_argument('--release', required=True)

    bak_parser = subparsers.add_parser('backup', help='Run a backup')

    rest_parser = subparsers.add_parser('restore', help='Run a restore drill')
    rest_parser.add_argument('--drill', action='store_true', help='Run as a drill')
    rest_parser.add_argument('--snapshot', required=True)

    stat_parser = subparsers.add_parser('status', help='Show current release and health')

    args = parser.parse_args()

    try:
        if args.command == 'provision':
            io = ComposeDeployIO(compose_file='docker-compose.yml', project_name='cineon')
            provision_release({"version": args.release}, io)
        elif args.command == 'deploy':
            io = ComposeDeployIO(compose_file='docker-compose.yml', project_name='cineon')
            deploy_release({"version": args.release}, io)
        elif args.command == 'backup':
            config = {
                "database_name": os.getenv('DB_NAME', 'cineon'),
                "mongo_config_path": os.getenv('MONGO_CONFIG', '/etc/mongodump.conf'),
                "redis_cli": "redis-cli",
                "restic_repo": os.getenv('RESTIC_REPO', '/mnt/backup'),
                "restic_password_file": os.getenv('RESTIC_PASSWORD_FILE')
            }
            io = SystemBackupIO(config)
            run_backup(io)
        elif args.command == 'restore':
            config = {
                "database_name": os.getenv('DB_NAME', 'cineon'),
                "mongo_config_path": os.getenv('MONGO_CONFIG', '/etc/mongodump.conf'),
                "restic_repo": os.getenv('RESTIC_REPO', '/mnt/backup'),
                "restic_password_file": os.getenv('RESTIC_PASSWORD_FILE')
            }
            io = SystemBackupIO(config)
            restore_drill(args.snapshot, '/tmp/restore_target', io)
        elif args.command == 'status':
            io = ComposeDeployIO(compose_file='docker-compose.yml', project_name='cineon')
            current = io.current()
            print(f"Current release: {current}")
            sys.exit(0)
    except Exception as e:
        print(f"Error: {e}", file=sys.stderr)
        sys.exit(1)

if __name__ == '__main__':
    main()
