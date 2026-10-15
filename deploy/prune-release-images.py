#!/usr/bin/env python3
"""Remove obsolete CineVN images, keeping container, deployment and rollback pins."""
import argparse
import fcntl
import json
from pathlib import Path
import subprocess

REPOSITORIES = ('ghcr.io/minhancr123/movie-web-backend', 'ghcr.io/minhancr123/movie-web-frontend')
ROLLBACKS = ('cineon-rollback-backend:previous', 'cineon-rollback-frontend:previous')


def obsolete_images(images, protected):
    selected = []
    for image in images:
        refs = (image.get('RepoTags') or []) + (image.get('RepoDigests') or [])
        own = any(ref.split('@')[0].split(':')[0] in REPOSITORIES for ref in refs)
        rollback = any(ref in ROLLBACKS for ref in refs)
        foreign_tag = any(ref.split('@')[0].split(':')[0] not in REPOSITORIES for ref in image.get('RepoTags') or [])
        if own and not rollback and not foreign_tag and image['Id'] not in protected:
            selected.append(image['Id'])
    return selected


def docker(*args, optional=False):
    result = subprocess.run(['docker', *args], text=True, capture_output=True)
    if result.returncode and not optional:
        raise RuntimeError('Docker inventory failed; no images removed')
    return result.stdout.strip() if result.returncode == 0 else ''


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--apply', action='store_true')
    parser.add_argument('--root', default='/opt/cineon')
    args = parser.parse_args()
    with open('/var/lock/cineon-production.lock', 'a') as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            print('Deploy/maintenance active; image cleanup skipped')
            return
        containers = docker('ps', '-aq').split()
        protected = set()
        if containers:
            protected.update(item['Image'] for item in json.loads(docker('inspect', *containers)))
        refs = list(ROLLBACKS)
        for name in ('.env', '.rollback.env'):
            file = Path(args.root) / name
            if file.exists():
                for line in file.read_text().splitlines():
                    key, sep, value = line.partition('=')
                    if sep and key in ('BACKEND_IMAGE', 'FRONTEND_IMAGE'):
                        refs.append(value.strip().strip('\"\''))
        for ref in refs:
            if ref:
                value = docker('image', 'inspect', '--format', '{{.Id}}', ref, optional=True)
                if value:
                    protected.add(value)
        ids = docker('image', 'ls', '-aq', '--no-trunc').split()
        images = json.loads(docker('image', 'inspect', *sorted(set(ids)))) if ids else []
        candidates = obsolete_images(images, protected)
        print(f'Obsolete CineVN images: {len(candidates)}; protected images: {len(protected)}')
        if args.apply:
            for image_id in candidates:
                # No --force: Docker also refuses images in use if inventory races.
                result = subprocess.run(['docker', 'image', 'rm', image_id], capture_output=True)
                print(f'{image_id[:19]}: {"removed" if result.returncode == 0 else "kept (Docker refused)"}')


if __name__ == '__main__':
    main()
