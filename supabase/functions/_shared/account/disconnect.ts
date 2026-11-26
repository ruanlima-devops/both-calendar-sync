import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { logSafe } from '../http.ts';
import { getValidAccessToken, providerFor } from '../sync/runtime.ts';
import type { ProviderName } from '../sync/types.ts';
import { cleanupConnectionExternal, type ExternalCleanupResult } from './delete-user.ts';
import { revokeProviderAuthorization } from './oauth-revoke.ts';

export type DisconnectResult =
  | { ok: true; removed: false }
  | ({ ok: true; removed: true; provider: ProviderName } & ExternalCleanupResult);

export type DisconnectDeps = {
  getAccessToken?: typeof getValidAccessToken;
  revoke?: typeof revokeProviderAuthorization;
  providerForFn?: typeof providerFor;
};

/**
 * Disconnects one calendar connection owned by userId. Idempotent: a connection that no longer
 * exists (or belongs to another user) is reported as not removed without touching anything.
 * Transient provider failures abort (AccountDeleteBlockedError) before credentials are destroyed.
 */
export async function disconnectConnection(
  db: SupabaseClient,
  userId: string,
  connectionId: string,
  encryptionKey: string,
  deps: DisconnectDeps = {},
): Promise<DisconnectResult> {
  const { data: conn } = await db
    .from('calendar_connections')
    .select('id, provider')
    .eq('id', connectionId)
    .eq('user_id', userId)
    .maybeSingle();
  if (!conn) {
    logSafe('calendar_disconnect_noop', { userId, connectionId });
    return { ok: true, removed: false };
  }

  const provider = conn.provider as ProviderName;
  const cleanup = await cleanupConnectionExternal(db, connectionId, provider, encryptionKey, {
    getAccessToken: deps.getAccessToken ?? getValidAccessToken,
    revoke: deps.revoke ?? revokeProviderAuthorization,
    resolveProvider: deps.providerForFn ?? providerFor,
    logPrefix: 'calendar_disconnect',
  });

  // Cascades secrets, calendars, events, webhook rows, sync_state and jobs.
  await db.from('calendar_connections').delete().eq('id', connectionId).eq('user_id', userId);
  logSafe('calendar_disconnected', { userId, connectionId, provider, ...cleanup });
  return { ok: true, removed: true, provider, ...cleanup };
}
