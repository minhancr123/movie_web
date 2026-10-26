import sys
import unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from aiostreams_profile import build_profile, add_request_presets

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
    def test_background_presets_do_not_change_foreground_or_enable_unavailable_addons(self):
        current={'presets':[{'type':'torrentio'}],'excludedStreamExpressions':[{'expression':'cached-only'}]}
        status={'settings':{'presets':[{'ID':'knaben','NAME':'Knaben'}, {'ID':'sootio','NAME':'Sootio','DISABLED':True}]}}
        profile=add_request_presets(status,current)
        self.assertEqual(profile['presets'],current['presets'])
        self.assertEqual(profile['excludedStreamExpressions'],current['excludedStreamExpressions'])
        self.assertEqual([p['type'] for p in profile['cinevnRequestPresets']],['knaben'])
        self.assertNotIn('cinevnRequestPresets',current)
if __name__=='__main__':unittest.main()
