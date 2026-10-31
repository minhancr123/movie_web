// Keep only hostnames, never signed download URLs. A TCP failure affects the
// route to a node, not every TorBox file or the provider's API.
export function createCdnCircuit({ now = Date.now, cooldownMs = 60000, maxEntries = 128 } = {}) {
  const failed = new Map();
  function host(url) {
    try {
      const parsed = new URL(url);
      return parsed.protocol === 'https:' && parsed.hostname.endsWith('.tb-cdn.pw')
        ? parsed.hostname : null;
    } catch { return null; }
  }
  return {
    recordFailure(url, stderr, { stopped = false } = {}) {
      const name = host(url);
      const text = String(stderr || '');
      // Do not blacklist a host for an expired token, a codec failure, a read
      // timeout, or warnings retained when a writer was deliberately stopped.
      if (stopped || !name || !text.includes(`tcp://${name}:`)
        || !/Connection to tcp:\/\/[^\s]+ failed: (?:Connection timed out|Connection refused|Network is unreachable|No route to host)/i.test(text)) return false;
      for (const [key, until] of failed) if (until <= now()) failed.delete(key);
      failed.delete(name);
      while (failed.size >= maxEntries) failed.delete(failed.keys().next().value);
      failed.set(name, now() + cooldownMs);
      return true;
    },
    remainingSeconds(url) {
      const name = host(url);
      const until = failed.get(name) || 0;
      if (until <= now()) { failed.delete(name); return 0; }
      return Math.ceil((until - now()) / 1000);
    },
  };
}

export const torboxCdnCircuit = createCdnCircuit();

export function assertCdnAvailable(url) {
  const retryAfterSeconds = torboxCdnCircuit.remainingSeconds(url);
  if (retryAfterSeconds) throw Object.assign(
    new Error('Máy chủ video vừa mất kết nối; đang tìm đường phát khác.'),
    { code: 'CDN_CONNECT_COOLDOWN', status: 503, retryAfterSeconds },
  );
  return url;
}
