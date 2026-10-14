import importlib.util
import json
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('quack', Path(__file__).parents[1] / 'aiostreams_quack.py')
quack = importlib.util.module_from_spec(spec)
spec.loader.exec_module(quack)


class QuackProfileTest(unittest.TestCase):
    def test_profile_preserves_discovery_and_never_inherits_account_credentials(self):
        current = {'presets': [{'type': 'custom', 'options': {'manifestUrl': 'https://example.test/manifest.json', 'timeout': 12000}}],
                   'services': [{'id': 'torbox', 'credentials': {'apiKey': 'must-not-copy'}}]}
        profile = quack.build_profile(current)
        self.assertEqual(profile['presets'][0]['options']['manifestUrl'], current['presets'][0]['options']['manifestUrl'])
        self.assertEqual(profile['services'], [{'id': 'torbox', 'enabled': False, 'credentials': {}}])
        self.assertNotIn('must-not-copy', json.dumps(profile))
        self.assertEqual(profile['resultLimits']['global'], 150)
        self.assertEqual(profile['resultLimits']['resolution'], 40)
        self.assertTrue(all(p['options']['timeout'] <= 3000 for p in profile['presets']))
        self.assertEqual({p['type'] for p in profile['presets']}, {'custom', 'zilean', 'knaben', 'seadex'})
        self.assertEqual(current['presets'][0]['options']['timeout'], 12000)
        self.assertFalse(profile['preloadStreams']['enabled'])

    def test_rebuilding_does_not_duplicate_scrapers_and_enforces_matching(self):
        first = quack.build_profile({'presets': []})
        second = quack.build_profile(first)
        self.assertEqual(first, second)
        self.assertTrue(second['yearMatching']['strict'])
        self.assertTrue(second['seasonEpisodeMatching']['strict'])
        self.assertGreater(len(second['rankedStreamExpressions']), 20)
