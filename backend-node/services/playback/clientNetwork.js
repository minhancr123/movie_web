/**
 * Where a viewer is watching from.
 *
 * The only thing this decides is how much bandwidth a stream may assume it has:
 * a client on the same LAN can take a 4K remux straight off the disk, while one
 * coming in over the uplink has to be paid for out of a fixed egress budget.
 * It is not a security boundary and must never be used as one — the address can
 * be forged wherever a proxy header is trusted.
 */

/** Reserved IPv4 ranges that mean "same building", as [network, maskBits]. */
const PRIVATE_V4 = [
  ['10.0.0.0', 8],
  ['172.16.0.0', 12],
  ['192.168.0.0', 16],
  ['127.0.0.0', 8], // loopback
  ['169.254.0.0', 16], // link-local, i.e. DHCP never answered
  ['100.64.0.0', 10], // CGNAT — Tailscale and friends live here
];

const v4ToInt = (ip) => {
  const parts = String(ip).split('.');
  if (parts.length !== 4) return null;
  let out = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const n = Number(part);
    if (n > 255) return null;
    out = out * 256 + n;
  }
  return out;
};

/**
 * Strips the shapes an address arrives in before it can be compared.
 * Node reports IPv4 over a dual-stack socket as "::ffff:192.168.1.5", and a
 * Forwarded header may carry a port or brackets.
 */
export const normalizeAddress = (raw) => {
  let ip = String(raw || '').trim();
  if (!ip) return '';
  if (ip.startsWith('[')) ip = ip.slice(1, ip.indexOf(']') > 0 ? ip.indexOf(']') : undefined);
  // Only strip a port from IPv4; a bare IPv6 address is full of colons.
  if (/^\d{1,3}(\.\d{1,3}){3}:\d+$/.test(ip)) ip = ip.slice(0, ip.lastIndexOf(':'));
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(ip);
  if (mapped) return mapped[1];
  return ip.toLowerCase();
};

export const isPrivateAddress = (raw) => {
  const ip = normalizeAddress(raw);
  if (!ip) return false;

  if (ip === '::1' || ip === '::') return true;
  // fc00::/7, the IPv6 equivalent of the ranges above.
  if (/^f[cd][0-9a-f]{2}:/i.test(ip)) return true;
  // fe80::/10 link-local.
  if (/^fe[89ab][0-9a-f]:/i.test(ip)) return true;

  const value = v4ToInt(ip);
  if (value === null) return false;
  return PRIVATE_V4.some(([network, bits]) => {
    const base = v4ToInt(network);
    const mask = bits === 0 ? 0 : (-1 << (32 - bits)) >>> 0;
    return (value & mask) >>> 0 === (base & mask) >>> 0;
  });
};

/**
 * The address to judge the client by.
 *
 * X-Forwarded-For is attacker-controlled unless something in front of the app
 * overwrites it, so it is read only when the deployment says a proxy is there.
 * Getting this backwards would let anyone claim to be on the LAN and take the
 * 4K path, which is a bandwidth bill rather than a breach, but still theirs to
 * hand out rather than a stranger's to take.
 */
export const clientAddress = (req, { trustProxy = false } = {}) => {
  if (trustProxy) {
    const forwarded = req?.headers?.['x-forwarded-for'];
    if (forwarded) {
      // Left-most entry is the original client; the rest are proxies.
      const first = String(forwarded).split(',')[0];
      if (first.trim()) return normalizeAddress(first);
    }
  }
  return normalizeAddress(req?.socket?.remoteAddress || req?.ip || '');
};

const TRUST_PROXY = String(process.env.TRUST_PROXY || '').toLowerCase() === 'true';

/**
 * True when the viewer is close enough that bandwidth is effectively free.
 * `LAN_EXTRA_CIDRS` widens it for setups where the players sit behind a router
 * the server does not share a subnet with.
 */
export const isLanClient = (req, { trustProxy = TRUST_PROXY, extra = process.env.LAN_EXTRA_CIDRS } = {}) => {
  const ip = clientAddress(req, { trustProxy });
  if (!ip) return false;
  if (isPrivateAddress(ip)) return true;

  const value = v4ToInt(ip);
  if (value === null || !extra) return false;
  return String(extra)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .some((cidr) => {
      const [network, bitsRaw] = cidr.split('/');
      const base = v4ToInt(network);
      const bits = Number(bitsRaw);
      if (base === null || !Number.isInteger(bits) || bits < 0 || bits > 32) return false;
      const mask = bits === 0 ? 0 : (-1 << (32 - bits)) >>> 0;
      return (value & mask) >>> 0 === (base & mask) >>> 0;
    });
};
