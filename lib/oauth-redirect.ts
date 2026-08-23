/** Mirror of Edge Function allowlist — keep in sync with supabase/functions/_shared/oauth.ts */

/** Current variant schemes plus legacy Unify until STAGE/PROD OAuth migration. */
const NATIVE_OAUTH_SCHEMES = ['both', 'both-dev', 'both-stg', 'unify'] as const;
// TODO(rebrand): remove legacy `unify` scheme after STAGE/PROD OAuth migration.

function isNativeOAuthRedirect(value: string): boolean {
  return NATIVE_OAUTH_SCHEMES.some(
    (scheme) =>
      value === `${scheme}://oauth` ||
      value.startsWith(`${scheme}://oauth?`) ||
      value.startsWith(`${scheme}://oauth/`),
  );
}

export function isSafeAppRedirect(redirect: string, options?: { appUrl?: string; allowlist?: string }): boolean {
  const value = redirect.trim();
  if (!value) return false;

  if (isNativeOAuthRedirect(value)) {
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
