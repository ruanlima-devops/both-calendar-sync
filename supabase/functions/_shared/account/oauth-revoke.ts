import { logSafe } from '../http.ts';
import type { ProviderName } from '../sync/types.ts';

export type RevokeResult = 'revoked' | 'already_gone' | 'skipped' | 'failed';

/**
 * Best-effort provider authorization cleanup for account deletion / disconnect.
 * Never logs token values.
 *
 * Distinct from operational webhook/subscription cleanup: revoke removes the OAuth
 * grant; watches/subscriptions are separate provider resources that must be stopped
 * while credentials still exist.
 */
export async function revokeProviderAuthorization(input: {
  provider: ProviderName;
  /** Prefer refresh token; Google also accepts access token. */
  token: string;
  microsoftTenant?: string;
  fetchImpl?: typeof fetch;
}): Promise<RevokeResult> {
  const fetchFn = input.fetchImpl ?? fetch;
  if (!input.token) return 'skipped';

  if (input.provider === 'GOOGLE') {
    try {
      const res = await fetchFn('https://oauth2.googleapis.com/revoke', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ token: input.token }),
      });
      // Google: 200 ok; 400 often means already invalid/revoked.
      if (res.ok) return 'revoked';
      if (res.status === 400) return 'already_gone';
      logSafe('oauth_revoke_failed', { provider: 'GOOGLE', status: res.status });
      return 'failed';
    } catch {
      logSafe('oauth_revoke_failed', { provider: 'GOOGLE', reason: 'network' });
      return 'failed';
    }
  }

  if (input.provider === 'MICROSOFT') {
    // Microsoft identity platform has no RFC 7009 endpoint for a single app's refresh token.
    // revokeSignInSessions invalidates every app's tokens for the user (and is unsupported for
    // personal accounts); deleting oauth2PermissionGrants needs admin-level Graph permissions.
    // Cleanup is therefore: delete Graph subscriptions + destroy the stored credentials.
    logSafe('oauth_revoke_skipped', { provider: 'MICROSOFT', reason: 'no_app_scoped_revoke' });
    return 'skipped';
  }

  // iCloud app-specific password: no OAuth revoke endpoint; local secret deletion is enough.
  return 'skipped';
}

/** Resource already gone — safe to continue account deletion. */
export function isSafeExternalCleanupError(err: unknown): boolean {
  const status = (err as { httpStatus?: number }).httpStatus;
  if (status === 404 || status === 410) return true;
  const message = String(err instanceof Error ? err.message : err).toLowerCase();
  return (
    message.includes('not found') ||
    message.includes('404') ||
    message.includes('410') ||
    message.includes('resource not found') ||
    message.includes('subscription not found')
  );
}

/**
 * Temporary provider failures — must NOT destroy credentials while watches/subs may still exist.
 */
export function isTransientExternalCleanupError(err: unknown): boolean {
  const code = (err as { code?: string }).code;
  if (
    code === 'RATE_LIMITED' ||
    code === 'PROVIDER_UNAVAILABLE' ||
    code === 'NETWORK_ERROR' ||
    code === 'TIMEOUT'
  ) {
    return true;
  }
  const status = (err as { httpStatus?: number }).httpStatus;
  if (status === 429 || status === 500 || status === 502 || status === 503 || status === 504) {
    return true;
  }
  const message = String(err instanceof Error ? err.message : err).toLowerCase();
  return (
    message.includes('timeout') ||
    message.includes('network') ||
    message.includes('fetch failed') ||
    message.includes('econnreset')
  );
}

/** Auth/permission failures on cleanup — cannot call provider; continue local delete. */
export function isAuthExternalCleanupError(err: unknown): boolean {
  const code = (err as { code?: string }).code;
  if (code === 'AUTH_REQUIRED' || code === 'PERMISSION_ERROR') return true;
  const status = (err as { httpStatus?: number }).httpStatus;
  return status === 401 || status === 403;
}

export class AccountDeleteBlockedError extends Error {
  readonly code = 'ACCOUNT_DELETE_BLOCKED';
  constructor(message: string) {
    super(message);
    this.name = 'AccountDeleteBlockedError';
  }
}
