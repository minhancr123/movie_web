/**
 * Normalising a Stremio addon URL to the base the endpoints hang off.
 *
 * buildSubtitleUrl appends `/subtitles/{type}/{id}.json`, so the configured
 * value has to be the base — but every addon catalogue hands out the
 * *manifest* URL, which is what anyone will naturally paste. Left as-is that
 * produces `.../manifest.json/subtitles/movie/tt123.json` and a silent 404:
 * the addon simply never returns subtitles and nothing says why.
 *
 * Run: node tests/addon-base-url.test.mjs
 */
import assert from 'node:assert/strict';
import { normalizeAddonBase } from '../services/addonClient.js';

assert.equal(
  normalizeAddonBase('https://opensubtitles-v3.strem.io'),
  'https://opensubtitles-v3.strem.io',
  'a bare base is left alone',
);
assert.equal(
  normalizeAddonBase('https://opensubtitles-v3.strem.io/manifest.json'),
  'https://opensubtitles-v3.strem.io',
  'the manifest URL people actually copy',
);
assert.equal(
  normalizeAddonBase('https://opensubtitles-v3.strem.io/'),
  'https://opensubtitles-v3.strem.io',
  'trailing slash',
);
assert.equal(
  normalizeAddonBase('https://opensubtitles-v3.strem.io/manifest.json/'),
  'https://opensubtitles-v3.strem.io',
  'both at once',
);
assert.equal(
  normalizeAddonBase('  https://x.test/manifest.json  '),
  'https://x.test',
  'padded by a copy-paste',
);
// A configured addon can carry its settings in the path — SubDL encodes the
// API key and language choices there — so only the final segment may go.
assert.equal(
  normalizeAddonBase('https://api3.subdl.com/c/v1.TOKEN/manifest.json'),
  'https://api3.subdl.com/c/v1.TOKEN',
  'config-in-path addons keep their path',
);
assert.equal(
  normalizeAddonBase('https://api3.subdl.com/c/v1.TOKEN'),
  'https://api3.subdl.com/c/v1.TOKEN',
);
// Never eat a path segment that merely resembles the manifest.
assert.equal(
  normalizeAddonBase('https://x.test/manifest.json.backup'),
  'https://x.test/manifest.json.backup',
);
assert.equal(
  normalizeAddonBase('https://x.test/my-manifest.json'),
  'https://x.test/my-manifest.json',
  'only the whole segment counts',
);
assert.equal(normalizeAddonBase(''), '');
assert.equal(normalizeAddonBase(null), '');
console.log('ok - addon manifest URLs normalise to the base the endpoints need');
