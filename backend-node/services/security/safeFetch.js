/**
 * SSRF-hardened outbound HTTP.
 *
 * Addon URLs are user-supplied, so a naive fetch would let anyone point us at
 * `http://169.254.169.254/` (cloud metadata), `http://127.0.0.1:6379` (our own
 * Redis), or a LAN box and read the response back through our API.
 *
 * The defence is resolve-then-pin:
 *   1. reject non-HTTP(S) schemes, credentials in the URL, and odd ports;
 *   2. resolve the hostname ourselves and reject every private/reserved address;
 *   3. connect to the vetted IP with the original Host header, so the name
 *      cannot be re-resolved to a different address between check and connect
 *      (DNS rebinding);
 *   4. re-validate every redirect hop the same way.
 */

import dns from 'dns/promises';
import net from 'net';
import http from 'http';
import https from 'https';

const ALLOWED_PORTS = new Set([80, 443, 8080, 8443, 7000]);
const MAX_REDIRECTS = 3;
const MAX_BODY_BYTES = 4 * 1024 * 1024;

export class SsrfError extends Error {
  constructor(message) {
    super(message);
    this.name = 'SsrfError';
    this.status = 400;
    this.code = 'blocked_url';
  }
}

/**
 * Reject anything not routable on the public internet.
 * Written against the address families rather than a regex blocklist, because
 * `0x7f.1`, `2130706433`, and `::ffff:127.0.0.1` all mean localhost.
 */
const reserved = new net.BlockList();
for (const [ip,prefix] of [['0.0.0.0',8],['10.0.0.0',8],['127.0.0.0',8],['169.254.0.0',16],
  ['172.16.0.0',12],['192.168.0.0',16],['192.0.0.0',24],['100.64.0.0',10],['198.18.0.0',15],
  ['192.0.2.0',24],['198.51.100.0',24],['203.0.113.0',24],['224.0.0.0',3]]) reserved.addSubnet(ip,prefix,'ipv4');
for (const [ip,prefix] of [['::',96],['::1',128],['fc00::',7],['fe80::',10],['ff00::',8],['2001:db8::',32]]) reserved.addSubnet(ip,prefix,'ipv6');
// Node normalizes mapped IPv4, including expanded/hex IPv6 spellings, and
// checks them against IPv4 subnets. String prefix checks miss those aliases.
export const isPrivateAddress = (address) => {
  const family = net.isIP(address);
  return !family || reserved.check(address, family === 4 ? 'ipv4' : 'ipv6');
};

/** Scheme / port / credential checks, before any DNS work. */
export const assertUrlShape = (rawUrl) => {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new SsrfError('URL không hợp lệ');
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new SsrfError(`Chỉ cho phép http/https, nhận được ${url.protocol}`);
  }
  if (url.username || url.password) {
    throw new SsrfError('URL không được chứa thông tin đăng nhập');
  }

  const port = Number(url.port || (url.protocol === 'https:' ? 443 : 80));
  if (!ALLOWED_PORTS.has(port)) {
    throw new SsrfError(`Cổng ${port} không được phép`);
  }

  return { url, port };
};

/** Resolve a hostname and keep only public addresses. */
const resolvePublicAddresses = async (hostname) => {
  // A literal IP skips DNS but still gets filtered.
  if (net.isIP(hostname)) {
    if (isPrivateAddress(hostname)) throw new SsrfError(`Địa chỉ ${hostname} thuộc dải nội bộ`);
    return [{ address: hostname, family: net.isIP(hostname) }];
  }

  let records;
  try {
    records = await dns.lookup(hostname, { all: true, verbatim: true });
  } catch {
    throw new SsrfError(`Không phân giải được tên miền ${hostname}`);
  }

  const safe = records.filter((record) => !isPrivateAddress(record.address));
  if (!safe.length) {
    // Every answer was internal: a rebinding attempt or a genuinely internal name.
    throw new SsrfError(`${hostname} chỉ trỏ tới địa chỉ nội bộ`);
  }
  return safe;
};

/**
 * One hop, pinned to a pre-vetted IP.
 * Uses node:http(s) rather than fetch because we must dictate the socket target
 * while keeping the original Host/SNI — fetch offers no hook for that.
 */
const requestOnce = ({ url, port, address, family, method, headers, timeoutMs, maxBytes }) =>
  new Promise((resolve, reject) => {
    const transport = url.protocol === 'https:' ? https : http;

    const req = transport.request(
      {
        method,
        host: address,
        port,
        path: `${url.pathname}${url.search}`,
        family,
        headers: { ...headers, host: url.host },
        servername: url.hostname, // keep TLS SNI on the real name
        timeout: timeoutMs,
        // Redirects are handled by the caller so each hop is re-validated.
      },
      (res) => {
        const chunks = [];
        let size = 0;
        res.on('data', (chunk) => {
          size += chunk.length;
          if (size > maxBytes) {
            req.destroy();
            reject(new SsrfError('Phản hồi vượt quá giới hạn dung lượng'));
            return;
          }
          chunks.push(chunk);
        });
        res.on('end', () =>
          resolve({
            status: res.statusCode || 0,
            headers: res.headers,
            body: Buffer.concat(chunks).toString('utf8'),
          })
        );
        res.on('error', reject);
      }
    );

    const deadline = setTimeout(() => req.destroy(new SsrfError('Quá thời gian tải phản hồi')), timeoutMs);
    req.once('close', () => clearTimeout(deadline));
    req.on('timeout', () => {
      req.destroy();
      reject(new SsrfError(`Quá ${timeoutMs / 1000}s không phản hồi`));
    });
    req.on('error', (error) => reject(new Error(`Kết nối thất bại: ${error.message}`)));
    req.end();
  });

/**
 * GET a user-supplied URL safely, following redirects with full re-validation.
 * Returns `{ status, headers, body }`; the caller parses.
 */
export const safeFetchText = async (rawUrl, { timeoutMs = 10000, headers = {}, maxBytes = MAX_BODY_BYTES } = {}) => {
  let target = rawUrl;
  const deadline = Date.now() + timeoutMs;
  maxBytes = Math.max(1, Math.min(MAX_BODY_BYTES, maxBytes));

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const { url, port } = assertUrlShape(target);
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new SsrfError('Quá thời gian tải phản hồi');
    let dnsTimer;
    const [picked] = await Promise.race([
      resolvePublicAddresses(url.hostname),
      new Promise((_, reject) => { dnsTimer = setTimeout(() => reject(new SsrfError('DNS timeout')), remaining); }),
    ]).finally(() => clearTimeout(dnsTimer));

    const response = await requestOnce({
      url,
      port,
      address: picked.address,
      family: picked.family,
      method: 'GET',
      headers: { accept: 'application/json', 'user-agent': 'MovieWeb/1.0', ...headers },
      timeoutMs: Math.max(1, deadline - Date.now()),
      maxBytes,
    });

    const isRedirect = response.status >= 300 && response.status < 400 && response.headers.location;
    if (!isRedirect) {
      if (response.status < 200 || response.status >= 300) {
        throw new Error(`Addon trả về ${response.status}`);
      }
      return response.body;
    }

    // Resolve relative Location against the current hop, then loop to re-check it.
    target = new URL(response.headers.location, url).toString();
  }

  throw new SsrfError(`Vượt quá ${MAX_REDIRECTS} lần chuyển hướng`);
};

export const safeFetchJson = async (rawUrl, options = {}) => {
  const body = await safeFetchText(rawUrl, options);
  try {
    return JSON.parse(body);
  } catch {
    throw new Error('Addon không trả về JSON hợp lệ');
  }
};
