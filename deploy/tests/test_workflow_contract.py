import unittest, re
from pathlib import Path

class WorkflowTest(unittest.TestCase):
    def test_remote_actions_are_pinned_to_commit(self):
        s = Path('.github/workflows/deploy.yml').read_text(encoding='utf-8')
        refs = re.findall(r'^\s*(?:-\s*)?uses:\s*([^\s#]+)', s, re.M)
        for ref in refs:
            if not ref.startswith('./'):
                self.assertRegex(ref, r'^[\w./-]+@[0-9a-f]{40}$')
        self.assertNotIn('git reset --quiet --hard', s)
