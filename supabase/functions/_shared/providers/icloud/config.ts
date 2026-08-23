/** Centralized iCloud CalDAV provider config — do not scatter hostnames. */

export const ICLOUD_CALDAV = {
  /** Well-known entry for discovery (HTTPS only). */
  discoveryOrigin: 'https://caldav.icloud.com',
  wellKnownPath: '/.well-known/caldav',
  /** Allowed host suffixes after redirects / discovery (SSRF guard). */
  allowedHostSuffixes: ['.icloud.com', 'icloud.com'] as const,
  connectTimeoutMs: 20_000,
  requestTimeoutMs: 25_000,
  maxResponseBytes: 8 * 1024 * 1024,
  /** Adaptive polling defaults (seconds). */
  pollActiveSeconds: 90,
  pollStableSeconds: 180,
  pollIdleSeconds: 300,
  pollMinSeconds: 45,
  pollMaxSeconds: 900,
} as const;

export function isAllowedIcloudHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return ICLOUD_CALDAV.allowedHostSuffixes.some(
    (suffix) => host === suffix.replace(/^\./, '') || host.endsWith(suffix),
  );
}

export function assertSafeIcloudUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('icloud_invalid_url');
  }
  if (url.protocol !== 'https:') throw new Error('icloud_https_required');
  if (!isAllowedIcloudHost(url.hostname)) throw new Error('icloud_host_not_allowed');
  return url;
}
