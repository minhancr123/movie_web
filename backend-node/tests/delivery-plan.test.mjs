/**
 * Who gets what quality, and who is told to wait.
 *
 * Two rules with teeth here. A forged proxy header must not buy the 4K path,
 * because the LAN check hands out bandwidth. And a busy uplink must narrow a
 * newcomer rather than admit everyone at full rate, which is how one person
 * compromising turns into everybody stuttering.
 */
import assert from 'node:assert/strict';
import { isPrivateAddress, normalizeAddress, clientAddress, isLanClient } from '../services/playback/clientNetwork.js';
import { planDelivery, planAdmission, LADDER } from '../services/playback/deliveryPlan.js';

/* ------------------------------------------------------------- addresses */

for (const ip of [
  '10.0.0.4', '10.255.255.255', '172.16.0.1', '172.31.255.254', '192.168.1.20',
  '127.0.0.1', '169.254.10.1', '100.64.1.1', '::1', 'fd00::1', 'fe80::abcd',
  '::ffff:192.168.1.5',
]) {
  assert.equal(isPrivateAddress(ip), true, `${ip} must count as local`);
}

for (const ip of [
  // 172.15 and 172.32 sit just outside the /12 and are a classic off-by-one.
  '172.15.0.1', '172.32.0.1', '8.8.8.8', '1.1.1.1', '203.0.113.5',
  '2001:4860:4860::8888', '11.0.0.1', '100.63.255.255', '100.128.0.1',
  '', null, undefined, 'not-an-ip', '999.1.1.1', '10.0.0',
]) {
  assert.equal(isPrivateAddress(ip), false, `${ip} must not count as local`);
}
console.log('ok - private ranges recognised, and their edges are not');

assert.equal(normalizeAddress('::ffff:10.1.2.3'), '10.1.2.3', 'dual-stack mapping must be unwrapped');
assert.equal(normalizeAddress('192.168.1.5:54321'), '192.168.1.5', 'a port must not defeat the match');
assert.equal(normalizeAddress('[2001:db8::1]'), '2001:db8::1', 'brackets must be stripped');
assert.equal(normalizeAddress('  10.0.0.1  '), '10.0.0.1');
// A bare IPv6 address is mostly colons and must survive the port stripping.
assert.equal(normalizeAddress('2001:db8::1'), '2001:db8::1');
console.log('ok - addresses normalised before they are judged');

/* ---------------------------------------------------------- proxy trust */

const req = (remote, forwarded) => ({
  socket: { remoteAddress: remote },
  headers: forwarded ? { 'x-forwarded-for': forwarded } : {},
});

// The header is attacker-controlled unless a proxy overwrites it, so by default
// it is ignored outright: claiming to be on the LAN must not buy the 4K path.
assert.equal(isLanClient(req('8.8.8.8', '192.168.1.9')), false, 'a forged header must not grant LAN');
assert.equal(clientAddress(req('8.8.8.8', '192.168.1.9')), '8.8.8.8');
assert.equal(clientAddress(req('8.8.8.8', '192.168.1.9'), { trustProxy: true }), '192.168.1.9');
assert.equal(isLanClient(req('8.8.8.8', '192.168.1.9'), { trustProxy: true }), true);
// Only the left-most entry is the client; the rest are proxies.
assert.equal(clientAddress(req('10.0.0.1', '203.0.113.9, 10.0.0.2'), { trustProxy: true }), '203.0.113.9');
assert.equal(isLanClient(req('192.168.1.4')), true, 'a real local socket is local');
console.log('ok - forwarded headers are ignored unless a proxy is declared');

assert.equal(isLanClient(req('203.0.113.5'), { extra: '203.0.113.0/24' }), true, 'extra CIDRs widen the LAN');
assert.equal(isLanClient(req('203.0.114.5'), { extra: '203.0.113.0/24' }), false);
assert.equal(isLanClient(req('8.8.8.8'), { extra: 'nonsense' }), false, 'a malformed CIDR must not match everything');
assert.equal(isLanClient(req('8.8.8.8'), { extra: '0.0.0.0/0' }), true, 'an explicit catch-all is the operator\'s call');
console.log('ok - extra CIDRs widen the LAN without opening it by accident');

/* ------------------------------------------------------------ delivery */

const lan = planDelivery({ lan: true, sourceHeight: 2160, sourceKbps: 30000 });
assert.equal(lan.mode, 'remux', 'a LAN client keeps the source untouched');
assert.equal(lan.height, 2160, 'and keeps its resolution');

const remote4k = planDelivery({ lan: false, sourceHeight: 2160, sourceKbps: 30000 });
assert.equal(remote4k.mode, 'transcode');
assert.equal(remote4k.height, 1080);
assert.equal(remote4k.kbps, 6000);

// Already small enough: re-encoding would spend a GPU to lose quality and save
// nothing, so it is passed through instead.
const remoteSmall = planDelivery({ lan: false, sourceHeight: 720, sourceKbps: 2500 });
assert.equal(remoteSmall.mode, 'remux', 'a source inside the rung must not be re-encoded');

// Small picture, fat bitrate: still worth re-encoding, and must not be upscaled.
const remoteFat = planDelivery({ lan: false, sourceHeight: 720, sourceKbps: 12000 });
assert.equal(remoteFat.mode, 'transcode');
assert.equal(remoteFat.height, 720, 'a 720p source must never come back as 1080p');

// Nothing known about the source is not a reason to ship 4K over the uplink.
const unknown = planDelivery({ lan: false, sourceHeight: null, sourceKbps: null });
assert.equal(unknown.mode, 'transcode', 'an unmeasured source must not default to passthrough');
assert.equal(unknown.height, 1080);
console.log('ok - LAN passes through, remote is capped, small sources are left alone');

/* ----------------------------------------------------------- admission */

const budget = 10000;

const first = planAdmission({ activeKbps: 0, sourceHeight: 2160, sourceKbps: 30000, budgetKbps: budget });
assert.equal(first.admitted, true);
assert.equal(first.height, 1080, 'an empty uplink serves the top rung');

// 6000 already spent leaves 4000: not enough for another 1080p, so the rung
// narrows rather than the viewer being refused.
const second = planAdmission({ activeKbps: 6000, sourceHeight: 2160, sourceKbps: 30000, budgetKbps: budget });
assert.equal(second.admitted, true);
assert.equal(second.height, 720, 'a squeezed uplink must narrow, not refuse');
assert.match(second.reason, /hạ bậc/);

// 8000 spent leaves 2000: too tight for 720p's 3200 but room for 480p's 1600.
const third = planAdmission({ activeKbps: 8000, sourceHeight: 2160, sourceKbps: 30000, budgetKbps: budget });
assert.equal(third.admitted, true);
assert.equal(third.height, 480, 'and narrow again before giving up');

// One rung's worth short of the floor is a refusal, not a rung that overspends.
const justShort = planAdmission({ activeKbps: 8500, sourceHeight: 2160, sourceKbps: 30000, budgetKbps: budget });
assert.equal(justShort.admitted, false, '8500 + 1600 exceeds the budget and must not be admitted');

const full = planAdmission({ activeKbps: 9800, sourceHeight: 2160, sourceKbps: 30000, budgetKbps: budget });
assert.equal(full.admitted, false, 'past the narrowest rung it has to say no');
assert.equal(full.mode, 'reject');
assert.match(full.reason, /uplink/i);

// LAN never crosses the uplink, so a saturated budget must not lock out the
// household the server is sitting in.
const lanWhenFull = planAdmission({ activeKbps: 999999, lan: true, sourceHeight: 2160, budgetKbps: budget });
assert.equal(lanWhenFull.admitted, true, 'LAN must not be charged for the uplink');
assert.equal(lanWhenFull.mode, 'remux');

// Rubbish accounting must not hand out free bandwidth. The budget has to be
// tighter than the narrowest rung to tell the two apart: with room to spare,
// a credited negative and a floored zero both admit the top rung and the bug
// hides. Here, floored means refuse; credited means 6 Mbps through a 1 Mbps pipe.
const negative = planAdmission({ activeKbps: -50000, sourceHeight: 2160, sourceKbps: 30000, budgetKbps: 1000 });
assert.equal(negative.admitted, false, 'negative usage must be floored at zero, not credited');
assert.ok(LADDER.every((r, i) => i === 0 || r.kbps < LADDER[i - 1].kbps), 'ladder must descend');
console.log('ok - admission narrows under pressure, refuses past the floor, exempts LAN');
