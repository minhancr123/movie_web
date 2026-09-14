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
export const isPrivateAddress = (address) => {
  const version = net.isIP(address);
  if (!version) return true; // not an IP at all -> refuse

  if (version === 4) {
    const parts = address.split('.').map(Number);
    const [a, b] = parts;

    if (a === 0) return true; // 0.0.0.0/8 "this network"
    if (a === 10) return true; // private
    if (a === 127) return true; // loopback
    if (a === 169 && b === 254) return true; // link-local incl. cloud metadata
    if (a === 172 && b >= 16 && b <= 31) return true; // private
    if (a === 192 && b === 168) return true; // private
    if (a === 192 && b === 0) return true; // IETF protocol assignments
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
    if (a === 198 && (b === 18 || b === 19)) return true; // benchmarking
    if (a >= 224) return true; // multicast + reserved + broadcast
    return false;
  }

  const lower = address.toLowerCase();
  if (lower === '::' || lower === '::1') return true; // unspecified / loopback
  if (lower.startsWith('fe8') || lower.startsWith('fe9') || lower.startsWith('fea') || lower.startsWith('feb')) {
    return true; // fe80::/10 link-local
  }
  if (/^f[cd]/.test(lower)) return true; // fc00::/7 unique-local
  if (lower.startsWith('ff')) return true; // multicast

  // IPv4-mapped (::ffff:a.b.c.d) inherits the IPv4 verdict.
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address);
  if (mapped) return isPrivateAddress(mapped[1]);

  return false;
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
const requestOnce = ({ url, port, address, family, method, headers, timeoutMs }) =>
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
          if (size > MAX_BODY_BYTES) {
            req.destroy();
            reject(new SsrfError('Phản hồi vượt quá 4MB'));
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
export const safeFetchJson = async (rawUrl, { timeoutMs = 10000, headers = {} } = {}) => {
  let target = rawUrl;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const { url, port } = assertUrlShape(target);
    const [picked] = await resolvePublicAddresses(url.hostname);

    const response = await requestOnce({
      url,
      port,
      address: picked.address,
      family: picked.family,
      method: 'GET',
      headers: { accept: 'application/json', 'user-agent': 'MovieWeb/1.0', ...headers },
      timeoutMs,
    });

    const isRedirect = response.status >= 300 && response.status < 400 && response.headers.location;
    if (!isRedirect) {
      if (response.status < 200 || response.status >= 300) {
        throw new Error(`Addon trả về ${response.status}`);
      }
      try {
        return JSON.parse(response.body);
      } catch {
        throw new Error('Addon không trả về JSON hợp lệ');
      }
    }

    // Resolve relative Location against the current hop, then loop to re-check it.
    target = new URL(response.headers.location, url).toString();
  }

  throw new SsrfError(`Vượt quá ${MAX_REDIRECTS} lần chuyển hướng`);
};
