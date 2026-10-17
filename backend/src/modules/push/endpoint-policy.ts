import { isIP } from 'node:net';

/**
 * The push services of the browsers. The server POSTs to the address a client gives it, so anything else would let a
 * logged-in user make the server call arbitrary addresses (internal ones too): only these hosts and their subdomains.
 */
const KNOWN_PUSH_SERVICES = [
  'fcm.googleapis.com',
  'push.apple.com',
  'push.services.mozilla.com',
  'notify.windows.com',
];

/** Whether an address may be used as a push endpoint: https, port 443, no login, not an IP, a known service. */
export function isAllowedPushEndpoint(raw: string, extraHosts: string[] = []): boolean {
  if (raw.length > 1000) return false;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:') return false;
  if (url.port !== '' && url.port !== '443') return false;
  if (url.username !== '' || url.password !== '') return false;
  const host = url.hostname.toLowerCase().replace(/\.$/, '');
  if (isIP(host) !== 0 || isIP(host.replace(/^\[|\]$/g, '')) !== 0) return false;
  return [...KNOWN_PUSH_SERVICES, ...extraHosts.map((item) => item.replace(/^\*\./, ''))].some(
    (service) => host === service || host.endsWith(`.${service}`),
  );
}
