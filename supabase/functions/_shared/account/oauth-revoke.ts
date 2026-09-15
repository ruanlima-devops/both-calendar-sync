import { logSafe } from '../http.ts';
import type { ProviderName } from '../sync/types.ts';

export type RevokeResult = 'revoked' | 'already_gone' | 'skipped' | 'failed';

/**
 * Best-effort provider authorization cleanup for account deletion / disconnect.
 * Never logs token values. M3-003 may harden Microsoft further.
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
    // Discarding tokens + deleting Graph subscriptions is the reliable cleanup for Both 1.0.
    // Full refresh-token revocation across tenants is deferred to M3-003 hardening.
    logSafe('oauth_revoke_skipped', { provider: 'MICROSOFT', reason: 'deferred_m3_003' });
    return 'skipped';
  }

  // iCloud app-specific password: no OAuth revoke endpoint; local secret deletion is enough.
  return 'skipped';
}

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
