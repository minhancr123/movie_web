import { isIP } from 'node:net';

// Docker keeps its existing public listener; a native installation can bind
// only to Nginx's loopback interface without carrying a server.js patch.
export function readListenerConfig(env = process.env) {
  const host = String(env.BIND_HOST || '0.0.0.0').trim();
  if (!isIP(host)) throw new Error('BIND_HOST must be an IPv4 or IPv6 address');
  const rawHops = String(env.TRUST_PROXY_HOPS ?? '0').trim();
  if (!/^[0-4]$/.test(rawHops)) throw new Error('TRUST_PROXY_HOPS must be between 0 and 4');
  return { host, trustProxyHops: Number(rawHops) };
}

/** Turn asynchronous bind failures into startup failures handled by the caller. */
export function listenHttpServer(server, port, host) {
  return new Promise((resolve, reject) => {
    const cleanup = () => { server.off('error', failed); server.off('listening', ready); };
    const failed = error => { cleanup(); reject(error); };
    const ready = () => { cleanup(); resolve(); };
    server.once('error', failed);
    server.once('listening', ready);
    try { server.listen(port, host); } catch (error) { failed(error); }
  });
}
