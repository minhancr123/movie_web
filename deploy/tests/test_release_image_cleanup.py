import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('cleanup', Path(__file__).parents[1] / 'prune-release-images.py')
cleanup = importlib.util.module_from_spec(spec)
spec.loader.exec_module(cleanup)


def image(name, tags=None, digests=None):
    return {'Id': name, 'RepoTags': tags or [], 'RepoDigests': digests or []}


class CleanupTests(unittest.TestCase):
    def test_digest_only_old_releases_are_removed_but_running_and_pinned_are_kept(self):
        repo = cleanup.REPOSITORIES[0]
        items = [image(n, tags=[repo+'@sha256:'+n], digests=[repo+'@sha256:'+n]) for n in ('old', 'running', 'pinned')]
        self.assertEqual(cleanup.obsolete_images(items, {'running', 'pinned'}), ['old'])

    def test_rollback_third_party_and_unknown_images_are_kept(self):
        repo = cleanup.REPOSITORIES[1]
        items = [image('rollback', tags=[cleanup.ROLLBACKS[1]], digests=[repo+'@sha256:x']),
                 image('foreign', tags=['redis:7']), image('unknown'),
                 image('retagged', tags=['custom:keep'], digests=[repo+'@sha256:z'])]
        self.assertEqual(cleanup.obsolete_images(items, set()), [])

    def test_owned_tags_are_selected(self):
        self.assertEqual(cleanup.obsolete_images([image('old', tags=[cleanup.REPOSITORIES[1]+':old'])], set()), ['old'])
