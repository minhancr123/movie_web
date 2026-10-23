import sys
import unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from aiostreams_profile import build_profile

class ProfileTests(unittest.TestCase):
    def test_only_supported_enabled_presets_and_no_saved_key(self):
        status={'data':{'settings':{'presets':[{'ID':'torrentio','NAME':'Torrentio'}, {'ID':'comet','NAME':'Comet','DISABLED':{'disabled':True}}]}}}
        profile=build_profile(status)
        self.assertEqual([p['type'] for p in profile['presets']],['torrentio'])
        self.assertTrue(profile['cinevnAccountScoped'])
        self.assertEqual(profile['services'][0]['credentials'],{})
        self.assertLessEqual(profile['presets'][0]['options']['timeout'],3000)
        self.assertEqual(profile['serviceWrap']['reconfigureService'],False)
    def test_no_silent_enable_when_requested_presets_absent(self):
        with self.assertRaises(ValueError):build_profile({'data':{'settings':{'presets':[]}}})
if __name__=='__main__':unittest.main()
