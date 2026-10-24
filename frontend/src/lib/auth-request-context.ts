/** Called only by the server-side NextAuth handler behind the trusted Nginx
 * origin. Forward request context, never cookies, authorization or OAuth tokens.
 */
export function authRequestHeaders(headers: Headers): Record<string, string> {
  const result: Record<string, string> = {};
  const ip = (headers.get('x-forwarded-for') || '').split(',')[0].trim();
  if (/^[a-f0-9:.]{3,45}$/i.test(ip)) result['X-Forwarded-For'] = ip;
  const ua = headers.get('user-agent');
  if (ua) result['User-Agent'] = ua.replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, 1024);
  return result;
}
