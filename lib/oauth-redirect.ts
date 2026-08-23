/** Mirror of Edge Function allowlist — keep in sync with supabase/functions/_shared/oauth.ts */

export function isSafeAppRedirect(redirect: string, options?: { appUrl?: string; allowlist?: string }): boolean {
  const value = redirect.trim();
  if (!value) return false;

  if (value === 'unify://oauth' || value.startsWith('unify://oauth?') || value.startsWith('unify://oauth/')) {
    return true;
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }

  const pathOk =
    url.pathname === '/oauth' || url.pathname.endsWith('/oauth') || url.pathname.includes('/oauth');

  if (url.protocol === 'exp:' || url.protocol === 'exps:') return pathOk;

  if (
    (url.protocol === 'http:' || url.protocol === 'https:') &&
    (url.hostname === 'localhost' || url.hostname === '127.0.0.1')
  ) {
    return pathOk;
  }

  const allowedOrigins = new Set<string>();
  if (options?.appUrl) {
    try {
      allowedOrigins.add(new URL(options.appUrl).origin);
    } catch {
      /* ignore */
    }
  }
  for (const part of (options?.allowlist ?? '').split(',').map((s) => s.trim()).filter(Boolean)) {
    try {
      allowedOrigins.add(new URL(part).origin);
    } catch {
      /* ignore */
    }
  }

  return url.protocol === 'https:' && allowedOrigins.has(url.origin) && pathOk;
}
