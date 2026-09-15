import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { decryptSecret } from '../crypto/tokens.ts';
import { logSafe } from '../http.ts';
import { getValidAccessToken, providerFor } from '../sync/runtime.ts';
import type { ProviderName } from '../sync/types.ts';
import {
  AccountDeleteBlockedError,
  isAuthExternalCleanupError,
  isSafeExternalCleanupError,
  isTransientExternalCleanupError,
  revokeProviderAuthorization,
} from './oauth-revoke.ts';

export type DeleteAccountResult = {
  ok: true;
  connectionsCleaned: number;
  jobsCancelled: number;
  authDeleted: boolean;
};

export type DeleteAccountDeps = {
  getAccessToken?: typeof getValidAccessToken;
  revoke?: typeof revokeProviderAuthorization;
  providerForFn?: typeof providerFor;
};

/**
 * Full Both account deletion for the authenticated userId (never from client body).
 * Idempotent where possible: missing external resources continue cleanup.
 * Transient failures stopping watches/subscriptions ABORT before credentials are destroyed.
 */
export async function deleteUserAccount(
  db: SupabaseClient,
  userId: string,
  encryptionKey: string,
  deps: DeleteAccountDeps = {},
): Promise<DeleteAccountResult> {
  const getAccessToken = deps.getAccessToken ?? getValidAccessToken;
  const revoke = deps.revoke ?? revokeProviderAuthorization;
  const resolveProvider = deps.providerForFn ?? providerFor;

  // 1) Stop new / in-flight work for this user.
  const { data: openJobs } = await db
    .from('sync_jobs')
    .select('id')
    .eq('user_id', userId)
    .in('status', ['pending', 'running']);
  const jobIds = (openJobs ?? []).map((j) => j.id as string);
  if (jobIds.length > 0) {
    await db
      .from('sync_jobs')
      .update({
        status: 'failed',
        error: 'account_deleted',
        completed_at: new Date().toISOString(),
      })
      .in('id', jobIds);
  }

  // 2) External provider cleanup while credentials still exist.
  const { data: connections } = await db
    .from('calendar_connections')
    .select('id, provider')
    .eq('user_id', userId);

  for (const conn of connections ?? []) {
    await cleanupConnectionExternal(db, String(conn.id), conn.provider as ProviderName, encryptionKey, {
      getAccessToken,
      revoke,
      resolveProvider,
    });
  }

  // 3) Internal rows that can block calendar CASCADE (RESTRICT FKs).
  await db.from('scheduling_links').delete().eq('user_id', userId);
  await db.from('oauth_states').delete().eq('user_id', userId);

  // 4) Connections → cascades calendars, secrets, events, webhooks, sync_state, firewall rules.
  for (const conn of connections ?? []) {
    await db.from('calendar_connections').delete().eq('id', conn.id).eq('user_id', userId);
  }

  // 5) Remaining user-owned data (most also cascade from profiles).
  await db.from('notifications').delete().eq('user_id', userId);
  await db.from('billing_events').update({ user_id: null }).eq('user_id', userId);
  await db.from('user_subscriptions').delete().eq('user_id', userId);
  await db.from('email_digest_log').delete().eq('user_id', userId);
  await db.from('calendar_firewall_rules').delete().eq('user_id', userId);
  await db.from('profiles').delete().eq('id', userId);

  // 6) Auth identity (admin). Idempotent if already gone.
  let authDeleted = false;
  const { error: authError } = await db.auth.admin.deleteUser(userId);
  if (!authError) {
    authDeleted = true;
  } else {
    const msg = authError.message.toLowerCase();
    if (msg.includes('not found') || msg.includes('user not found')) {
      authDeleted = true;
    } else {
      throw new Error(authError.message);
    }
  }

  logSafe('account_deleted', {
    userId,
    connectionsCleaned: (connections ?? []).length,
    jobsCancelled: jobIds.length,
    authDeleted,
  });

  return {
    ok: true,
    connectionsCleaned: (connections ?? []).length,
    jobsCancelled: jobIds.length,
    authDeleted,
  };
}

async function cleanupConnectionExternal(
  db: SupabaseClient,
  connectionId: string,
  provider: ProviderName,
  encryptionKey: string,
  deps: {
    getAccessToken: typeof getValidAccessToken;
    revoke: typeof revokeProviderAuthorization;
    resolveProvider: typeof providerFor;
  },
): Promise<void> {
  const { data: subs } = await db
    .from('webhook_subscriptions')
    .select('id, external_subscription_id, external_resource_id, expires_at, status')
    .eq('connection_id', connectionId);

  const activeSubs = (subs ?? []).filter((s) => s.status === 'active' || !s.status);

  let accessToken = '';
  let refreshToken = '';
  try {
    const tokens = await deps.getAccessToken(db, connectionId);
    accessToken = tokens.accessToken;
  } catch (err) {
    logSafe('account_delete_token_unavailable', {
      connectionId,
      provider,
      reason: isSafeExternalCleanupError(err) ? 'gone' : 'auth_or_error',
    });
    if (activeSubs.length > 0 && isTransientExternalCleanupError(err)) {
      throw new AccountDeleteBlockedError('external_cleanup_transient');
    }
  }

  if (accessToken && provider !== 'ICLOUD') {
    try {
      const impl = deps.resolveProvider(provider);
      for (const sub of activeSubs) {
        try {
          await impl.deleteWebhookSubscription(accessToken, {
            externalSubscriptionId: String(sub.external_subscription_id),
            externalResourceId: sub.external_resource_id ? String(sub.external_resource_id) : undefined,
            expiresAt: String(sub.expires_at),
          });
        } catch (err) {
          if (isSafeExternalCleanupError(err)) {
            continue;
          }
          if (isTransientExternalCleanupError(err)) {
            logSafe('account_delete_webhook_stop_blocked', { connectionId, provider, reason: 'transient' });
            throw new AccountDeleteBlockedError('external_cleanup_transient');
          }
          if (isAuthExternalCleanupError(err)) {
            logSafe('account_delete_webhook_stop_auth', { connectionId, provider });
            continue;
          }
          logSafe('account_delete_webhook_stop_blocked', { connectionId, provider, reason: 'unknown' });
          throw new AccountDeleteBlockedError('external_cleanup_failed');
        }
      }
    } catch (err) {
      if (err instanceof AccountDeleteBlockedError) throw err;
      if (isTransientExternalCleanupError(err)) {
        throw new AccountDeleteBlockedError('external_cleanup_transient');
      }
      logSafe('account_delete_webhook_stop_failed', { connectionId, provider });
      throw new AccountDeleteBlockedError('external_cleanup_failed');
    }
  } else if (!accessToken && activeSubs.length > 0 && provider !== 'ICLOUD') {
    // No usable token (typically AUTH_REQUIRED): cannot stop provider resources.
    // Continue local delete — orphan watches expire; user cannot re-auth mid-delete.
    logSafe('account_delete_webhook_unstopped', { connectionId, provider, reason: 'no_access_token' });
  }

  try {
    const { data: secret } = await db
      .from('calendar_secrets')
      .select('encrypted_refresh_token')
      .eq('connection_id', connectionId)
      .maybeSingle();
    if (secret?.encrypted_refresh_token) {
      refreshToken = await decryptSecret(String(secret.encrypted_refresh_token), encryptionKey);
    }
  } catch {
    /* secrets may already be gone on retry */
  }

  // OAuth grant revoke is best-effort and must not block account deletion.
  const revokeToken = refreshToken || accessToken;
  if (revokeToken) {
    await deps.revoke({ provider, token: revokeToken });
  }

  if (activeSubs.length > 0) {
    await db
      .from('webhook_subscriptions')
      .update({ status: 'expired' })
      .eq('connection_id', connectionId)
      .eq('status', 'active');
  }
}
