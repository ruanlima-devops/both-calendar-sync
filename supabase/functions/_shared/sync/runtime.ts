import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { decryptSecret, encryptSecret, needsRefresh, randomHex, sha256Hex } from '../crypto/tokens.ts';
import type { FirewallRule } from '../firewall/rules.ts';
import { env, envOptional, functionPublicUrl, logSafe } from '../http.ts';
import { GoogleCalendarProvider } from '../providers/google.ts';
import { MicrosoftCalendarProvider } from '../providers/microsoft.ts';
import { ICloudCalendarProvider } from '../providers/icloud/mod.ts';
import { ICLOUD_CALDAV } from '../providers/icloud/config.ts';
import { icloudAccessToken } from '../providers/icloud/provider.ts';
import { notificationDraftForSync } from '../notifications/messages.ts';
import { persistCalendarNotification } from '../notifications/store.ts';
import { googleFullSyncWindow } from './dates.ts';
import { applyIncomingEvent, createOriginWithOptionalMirrors } from './engine.ts';
import { PostgresStore } from './postgres-store.ts';
import type {
  CalendarProvider,
  CreateEventInput,
  MirrorActor,
  NormalizedEvent,
  ProviderName,
  StoredEvent,
  SyncContext,
  SyncPage,
  TargetCalendar,
} from './types.ts';

export function encryptionKey(): string {
  return env('TOKEN_ENCRYPTION_KEY');
}

export function providerFor(name: ProviderName): CalendarProvider {
  if (name === 'GOOGLE') {
    return new GoogleCalendarProvider(env('GOOGLE_CLIENT_ID'), env('GOOGLE_CLIENT_SECRET'));
  }
  if (name === 'MICROSOFT') {
    return new MicrosoftCalendarProvider(
      env('MICROSOFT_CLIENT_ID'),
      env('MICROSOFT_CLIENT_SECRET'),
      envOptional('MICROSOFT_TENANT') ?? 'common',
    );
  }
  return new ICloudCalendarProvider();
}

export async function createPkce(): Promise<{ verifier: string; challenge: string }> {
  const verifier = randomHex(32);
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  const challenge = btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  return { verifier, challenge };
}

export async function logSync(
  db: SupabaseClient,
  row: {
    userId?: string;
    provider?: string;
    calendarId?: string;
    operation: string;
    result: string;
    latencyMs?: number;
    errorCode?: string;
    detail?: string;
  },
): Promise<void> {
  await db.from('sync_log').insert({
    user_id: row.userId ?? null,
    provider: row.provider ?? null,
    calendar_id: row.calendarId ?? null,
    operation: row.operation,
    result: row.result,
    latency_ms: row.latencyMs ?? null,
    error_code: row.errorCode ?? null,
    detail: row.detail ?? null,
  });
}

export async function track(db: SupabaseClient, userId: string | null, name: string): Promise<void> {
  await db.from('product_events').insert({ user_id: userId, name });
}

export async function getValidAccessToken(
  db: SupabaseClient,
  connectionId: string,
): Promise<{ accessToken: string; provider: ProviderName; userId: string }> {
  const { data: conn, error } = await db
    .from('calendar_connections')
    .select('id, user_id, provider, status, account_email')
    .eq('id', connectionId)
    .single();
  if (error || !conn) throw new Error('connection_not_found');

  const { data: secret } = await db
    .from('calendar_secrets')
    .select('encrypted_refresh_token, encrypted_access_token, token_expires_at')
    .eq('connection_id', connectionId)
    .single();
  if (!secret) throw new Error('secrets_not_found');

  const key = encryptionKey();
  const refreshToken = await decryptSecret(secret.encrypted_refresh_token, key);

  // iCloud: app-specific password in refresh; packed email\\npassword as access.
  if (conn.provider === 'ICLOUD') {
    const email = String(conn.account_email ?? '');
    if (!email) throw new Error('icloud_email_missing');
    const accessToken = icloudAccessToken(email, refreshToken);
    return { accessToken, provider: 'ICLOUD', userId: conn.user_id };
  }

  let accessToken = secret.encrypted_access_token
    ? await decryptSecret(secret.encrypted_access_token, key)
    : '';

  if (!accessToken || needsRefresh(secret.token_expires_at)) {
    const provider = providerFor(conn.provider as ProviderName);
    try {
      const refreshed = await provider.refreshAccessToken(refreshToken);
      accessToken = refreshed.accessToken;
      await db
        .from('calendar_secrets')
        .update({
          encrypted_access_token: await encryptSecret(accessToken, key),
          encrypted_refresh_token: refreshed.refreshToken
            ? await encryptSecret(refreshed.refreshToken, key)
            : secret.encrypted_refresh_token,
          token_expires_at: refreshed.expiresAt,
        })
        .eq('connection_id', connectionId);
      if (conn.status === 'AUTH_REQUIRED') {
        await db
          .from('calendar_connections')
          .update({ status: 'CONNECTED', last_sync_error: null })
          .eq('id', connectionId);
      }
    } catch (err) {
      const message = String(err);
      const status =
        (err as { status?: string }).status === 'AUTH_REQUIRED' ||
        message.includes('invalid_grant') ||
        message.includes('icloud_auth_failed')
          ? 'AUTH_REQUIRED'
          : 'ERROR';
      await db
        .from('calendar_connections')
        .update({ status, last_sync_error: 'token_refresh_failed' })
        .eq('id', connectionId);
      await logSync(db, {
        userId: conn.user_id,
        provider: conn.provider,
        operation: 'token_refresh_failed',
        result: 'error',
        errorCode: status,
      });
      throw err;
    }
  }

  return { accessToken, provider: conn.provider as ProviderName, userId: conn.user_id };
}

export class ProviderMirrorActor implements MirrorActor {
  constructor(private readonly db: SupabaseClient) {}

  async createEvent(target: TargetCalendar, input: CreateEventInput) {
    const { accessToken, provider } = await getValidAccessToken(this.db, target.connectionId);
    return providerFor(provider).createEvent(accessToken, target.providerCalendarId, input);
  }

  async updateEvent(
    stored: StoredEvent,
    input: {
      startAt: string;
      endAt: string;
      allDay: boolean;
      timezone: string;
      title: string;
      description?: string;
    },
  ) {
    const { accessToken, provider } = await getValidAccessToken(this.db, stored.connectionId);
    await providerFor(provider).updateEvent(accessToken, stored.providerCalendarId, stored.providerEventId, {
      ...input,
      role: 'MIRROR',
      syncGroupId: stored.syncGroupId ?? undefined,
    });
  }

  async deleteEvent(stored: StoredEvent) {
    const { accessToken, provider } = await getValidAccessToken(this.db, stored.connectionId);
    try {
      await providerFor(provider).deleteEvent(accessToken, stored.providerCalendarId, stored.providerEventId);
    } catch (err) {
      const status = (err as { httpStatus?: number }).httpStatus;
      // Already gone on provider — treat as success so cascade can finish locally.
      if (status === 404 || status === 410) return;
      throw err;
    }
  }
}

export async function loadSyncContext(
  db: SupabaseClient,
  calendarId: string,
): Promise<{ ctx: SyncContext; calendar: Record<string, unknown> }> {
  const { data: calendar, error } = await db
    .from('connected_calendars')
    .select('*, calendar_connections!inner(id, user_id, provider, status)')
    .eq('id', calendarId)
    .single();
  if (error || !calendar) throw new Error('calendar_not_found');
  const conn = calendar.calendar_connections as { id: string; user_id: string; provider: ProviderName };
  const { data: targets } = await db
    .from('connected_calendars')
    .select('id, connection_id, provider_calendar_id, enabled, access_role, calendar_connections!inner(provider)')
    .eq('user_id', conn.user_id)
    .eq('enabled', true);

  const { data: ruleRows } = await db
    .from('calendar_firewall_rules')
    .select('*')
    .eq('user_id', conn.user_id)
    .eq('source_calendar_id', calendarId)
    .eq('enabled', true);

  const ctx: SyncContext = {
    userId: conn.user_id,
    connectionId: conn.id,
    connectedCalendarId: calendar.id,
    provider: conn.provider,
    autoBlockOthers: Boolean(calendar.auto_block_others),
    targets: (targets ?? []).map((t) => ({
      id: t.id,
      connectionId: t.connection_id,
      provider: (t.calendar_connections as { provider: ProviderName }).provider,
      providerCalendarId: t.provider_calendar_id,
      enabled: t.enabled,
      accessRole: t.access_role,
    })),
    firewallRules: (ruleRows ?? []).map((r) => ({
      id: String(r.id),
      userId: String(r.user_id),
      sourceCalendarId: String(r.source_calendar_id),
      destinationCalendarId: String(r.destination_calendar_id),
      enabled: Boolean(r.enabled),
      privacyPreset: r.privacy_preset as FirewallRule['privacyPreset'],
      syncTitle: Boolean(r.sync_title),
      syncDescription: Boolean(r.sync_description),
      syncLocation: Boolean(r.sync_location),
      syncAttendees: Boolean(r.sync_attendees),
      syncConference: Boolean(r.sync_conference),
      ignoreFree: Boolean(r.ignore_free),
      ignoreCancelled: Boolean(r.ignore_cancelled),
      placeholderTitle: String(r.placeholder_title ?? 'Horário reservado · Both'),
      busyStatus: (r.busy_status as FirewallRule['busyStatus']) ?? 'busy',
    })),
  };
  return { ctx, calendar: calendar as Record<string, unknown> };
}

type PulledPages = {
  events: NormalizedEvent[];
  nextSyncToken?: string;
  nextDeltaLink?: string;
  pages: number;
  truncated: boolean;
  needsFullResync: boolean;
};

async function pullAllPages(
  fetchPage: (pageToken?: string) => Promise<SyncPage>,
  maxPages = 40,
): Promise<PulledPages> {
  const events: NormalizedEvent[] = [];
  let pageToken: string | undefined;
  let nextSyncToken: string | undefined;
  let nextDeltaLink: string | undefined;
  let pages = 0;
  do {
    const page = await fetchPage(pageToken);
    if (page.needsFullResync) {
      return { events: [], pages, truncated: false, needsFullResync: true };
    }
    events.push(...page.events);
    pages += 1;
    pageToken = page.nextPageToken;
    if (page.nextSyncToken) nextSyncToken = page.nextSyncToken;
    if (page.nextDeltaLink) nextDeltaLink = page.nextDeltaLink;
    if (pages >= maxPages && pageToken) {
      return { events, nextSyncToken, nextDeltaLink, pages, truncated: true, needsFullResync: false };
    }
  } while (pageToken);
  return { events, nextSyncToken, nextDeltaLink, pages, truncated: false, needsFullResync: false };
}

async function notifyVisibleCalendarChange(
  db: SupabaseClient,
  ctx: SyncContext,
  previous: StoredEvent | null,
  incoming: NormalizedEvent,
  stored: StoredEvent | null,
  syncMode: 'full' | 'incremental',
): Promise<void> {
  const draft = notificationDraftForSync(
    syncMode,
    previous,
    {
      title: incoming.title,
      startAt: incoming.startAt,
      endAt: incoming.endAt,
      allDay: incoming.allDay,
      location: incoming.location,
      eventRole: previous?.eventRole ?? incoming.unifyEventRole ?? 'EXTERNAL',
    },
    incoming.timezone || previous?.timezone || 'UTC',
    Boolean(incoming.isDeleted || incoming.status === 'cancelled'),
    ctx.provider,
  );
  if (!draft) return;
  await persistCalendarNotification(db, {
    userId: ctx.userId,
    provider: ctx.provider,
    connectionId: ctx.connectionId,
    eventId: stored?.id ?? previous?.id,
    providerEventId: incoming.providerEventId,
    draft,
    startAt: incoming.startAt || previous?.startAt || new Date().toISOString(),
    allDay: incoming.allDay,
    version: incoming.updatedAt ?? incoming.etag ?? `${draft.kind}:${incoming.startAt}`,
  });
}

export async function syncConnectedCalendar(
  db: SupabaseClient,
  calendarId: string,
  mode: 'initial' | 'incremental' | 'auto' = 'auto',
): Promise<{ imported: number; errors: string[] }> {
  const started = Date.now();
  const { ctx, calendar } = await loadSyncContext(db, calendarId);
  const { accessToken, provider } = await getValidAccessToken(db, ctx.connectionId);
  const impl = providerFor(provider);
  const store = new PostgresStore(db);
  const actor = new ProviderMirrorActor(db);
  const providerCalendarId = String(calendar.provider_calendar_id);
  const calendarName = String(calendar.name ?? '');
  const range = googleFullSyncWindow();

  await db.from('calendar_connections').update({ status: 'SYNCING' }).eq('id', ctx.connectionId);

  const { data: state } = await db
    .from('sync_state')
    .select('*')
    .eq('connected_calendar_id', calendarId)
    .maybeSingle();

  const hasCursor = Boolean(
    state?.google_sync_token || state?.microsoft_delta_link || state?.caldav_sync_token,
  );
  let syncMode: 'full' | 'incremental' = mode === 'initial' || (mode === 'auto' && !hasCursor)
    ? 'full'
    : 'incremental';

  logSafe('[calendar-sync]', {
    provider,
    calendarId: providerCalendarId,
    calendarName,
    visible: calendar.enabled !== false,
    syncMode,
  });

  const runFull = () =>
    pullAllPages((pageToken) => impl.initialSync(accessToken, providerCalendarId, pageToken, range));
  const runIncremental = (token: string) =>
    pullAllPages((pageToken) => impl.incrementalSync(accessToken, providerCalendarId, token, pageToken));

  let pulled: PulledPages;
  try {
    if (syncMode === 'incremental') {
      const token = String(
        provider === 'GOOGLE'
          ? state?.google_sync_token
          : provider === 'MICROSOFT'
            ? state?.microsoft_delta_link
            : state?.caldav_sync_token,
      );
      pulled = await runIncremental(token);
      if (pulled.needsFullResync) {
        logSafe('[calendar-sync]', { calendarId: providerCalendarId, syncTokenInvalid: true });
        syncMode = 'full';
        pulled = await runFull();
      }
    } else {
      pulled = await runFull();
    }
  } catch (err) {
    const message = String(err);
    const authFailed =
      message.includes('icloud_auth_failed') || (err as { status?: string }).status === 'AUTH_REQUIRED';
    const { data: prevConn } = await db
      .from('calendar_connections')
      .select('consecutive_sync_failures, poll_interval_seconds')
      .eq('id', ctx.connectionId)
      .maybeSingle();
    const failures = Number(prevConn?.consecutive_sync_failures ?? 0) + 1;
    const backoff = Math.min(
      ICLOUD_CALDAV.pollMaxSeconds,
      Math.max(
        ICLOUD_CALDAV.pollMinSeconds,
        Number(prevConn?.poll_interval_seconds ?? ICLOUD_CALDAV.pollActiveSeconds) * Math.min(failures, 4),
      ),
    );
    await db
      .from('calendar_connections')
      .update({
        status: authFailed ? 'AUTH_REQUIRED' : 'DEGRADED',
        last_sync_error: authFailed ? 'auth_required' : 'sync_failed',
        consecutive_sync_failures: failures,
        ...(provider === 'ICLOUD'
          ? {
              poll_interval_seconds: backoff,
              next_sync_at: new Date(Date.now() + backoff * 1000 + Math.floor(Math.random() * 15_000)).toISOString(),
            }
          : {}),
      })
      .eq('id', ctx.connectionId);
    await db.from('sync_state').upsert(
      {
        connected_calendar_id: calendarId,
        last_attempt_at: new Date().toISOString(),
        last_error: 'sync_failed',
      },
      { onConflict: 'connected_calendar_id' },
    );
    await logSync(db, {
      userId: ctx.userId,
      provider,
      calendarId,
      operation: 'sync_failed',
      result: 'error',
      latencyMs: Date.now() - started,
      detail: String(err),
    });
    throw err;
  }

  logSafe('[calendar-sync]', {
    calendarId: providerCalendarId,
    syncMode,
    googleEventsReceived: pulled.events.length,
    pages: pulled.pages,
    nextPagePresent: pulled.truncated,
    nextSyncTokenPresent: Boolean(pulled.nextSyncToken || pulled.nextDeltaLink),
  });

  let imported = 0;
  const errors: string[] = [];
  let upsertFailed = false;
  for (const incoming of pulled.events) {
    try {
      const previous = await store.findByProviderEventId(calendarId, incoming.providerEventId);
      const result = await applyIncomingEvent(ctx, incoming, store, actor);
      imported += 1;
      errors.push(...result.errors);
      if (result.errors.length === 0) {
        await notifyVisibleCalendarChange(db, ctx, previous, incoming, result.stored, syncMode);
      }
      if (result.createdMirrors > 0) {
        await track(db, ctx.userId, 'mirror_created');
        await track(db, ctx.userId, 'external_event_synced');
      }
    } catch (err) {
      upsertFailed = true;
      errors.push(err instanceof Error ? err.message : 'upsert_failed');
    }
  }

  const complete = !pulled.truncated && !upsertFailed;
  const nextGoogleToken = complete && provider === 'GOOGLE'
    ? pulled.nextSyncToken ?? null
    : complete
      ? null
      : (state?.google_sync_token ?? null);
  const nextMicrosoftLink = complete && provider === 'MICROSOFT'
    ? pulled.nextDeltaLink ?? null
    : complete
      ? null
      : (state?.microsoft_delta_link ?? null);
  const nextCaldavToken = complete && provider === 'ICLOUD'
    ? pulled.nextSyncToken ?? null
    : complete
      ? null
      : (state?.caldav_sync_token ?? null);

  await db.from('sync_state').upsert(
    {
      connected_calendar_id: calendarId,
      google_sync_token: nextGoogleToken,
      google_page_token: null,
      microsoft_delta_link: nextMicrosoftLink,
      caldav_sync_token: nextCaldavToken,
      last_success_at: complete ? new Date().toISOString() : state?.last_success_at ?? null,
      last_attempt_at: new Date().toISOString(),
      last_error: complete ? (errors[0] ?? null) : (errors[0] ?? 'sync_incomplete'),
    },
    { onConflict: 'connected_calendar_id' },
  );

  const changed = imported > 0;
  const pollSeconds = provider === 'ICLOUD'
    ? (changed ? ICLOUD_CALDAV.pollActiveSeconds : ICLOUD_CALDAV.pollStableSeconds)
    : null;
  const jitterMs = pollSeconds ? Math.floor(Math.random() * 20_000) : 0;

  await db
    .from('calendar_connections')
    .update({
      status: complete && errors.length === 0 ? 'CONNECTED' : 'DEGRADED',
      last_sync_error: complete && errors.length === 0 ? null : (errors[0] ?? 'sync_incomplete'),
      ...(complete && errors.length === 0 ? { consecutive_sync_failures: 0 } : {}),
      ...(complete ? { last_sync_at: new Date().toISOString() } : {}),
      ...(pollSeconds
        ? {
            poll_interval_seconds: pollSeconds,
            next_sync_at: new Date(Date.now() + pollSeconds * 1000 + jitterMs).toISOString(),
          }
        : {}),
    })
    .eq('id', ctx.connectionId);

  logSafe('[calendar-sync]', {
    calendarId: providerCalendarId,
    upserted: imported,
    errors: errors.length,
    completed: complete,
  });

  await logSync(db, {
    userId: ctx.userId,
    provider,
    calendarId,
    operation: complete ? 'sync_completed' : 'sync_incomplete',
    result: complete && errors.length === 0 ? 'ok' : 'error',
    latencyMs: Date.now() - started,
    detail: `imported=${imported} pages=${pulled.pages}`,
  });

  if (!complete) throw new Error('sync_incomplete');
  try {
    await ensureWebhook(db, calendarId);
  } catch (err) {
    logSafe('[google-watch] post_sync_failed', {
      calendarId,
      message: err instanceof Error ? err.message : 'unknown',
    });
  }
  return { imported, errors };
}

async function nextPendingJob(
  db: SupabaseClient,
  connectionId: string,
  calendarId?: string | null,
): Promise<string | null> {
  let query = db
    .from('sync_jobs')
    .select('id')
    .eq('connection_id', connectionId)
    .eq('status', 'pending')
    .order('created_at', { ascending: true })
    .limit(1);
  if (calendarId) query = query.eq('connected_calendar_id', calendarId);
  const { data } = await query.maybeSingle();
  return data?.id ?? null;
}

export async function enqueueSync(
  db: SupabaseClient,
  input: {
    userId: string;
    connectionId: string;
    calendarId?: string;
    reason: string;
    dedupeKey: string;
  },
): Promise<string> {
  if (input.calendarId) {
    const { data: open } = await db
      .from('sync_jobs')
      .select('id, status')
      .eq('connected_calendar_id', input.calendarId)
      .in('status', ['pending', 'running']);
    const pending = (open ?? []).find((row) => row.status === 'pending');
    if (pending) return pending.id as string;
    const running = (open ?? []).find((row) => row.status === 'running');
    if (running) {
      input = { ...input, dedupeKey: `watch:${input.calendarId}:followup` };
      const { data: follow } = await db
        .from('sync_jobs')
        .select('id')
        .eq('dedupe_key', input.dedupeKey)
        .eq('status', 'pending')
        .maybeSingle();
      if (follow) return follow.id as string;
    }
  }

  const { data: existing } = await db
    .from('sync_jobs')
    .select('id')
    .eq('dedupe_key', input.dedupeKey)
    .in('status', ['pending', 'running'])
    .maybeSingle();
  if (existing) return existing.id as string;

  const { data, error } = await db
    .from('sync_jobs')
    .insert({
      user_id: input.userId,
      connection_id: input.connectionId,
      connected_calendar_id: input.calendarId ?? null,
      reason: input.reason,
      dedupe_key: input.dedupeKey,
      status: 'pending',
    })
    .select('id')
    .single();
  if (error || !data) throw new Error(error?.message ?? 'enqueue_failed');
  return data.id as string;
}

export async function processSyncJob(db: SupabaseClient, jobId: string): Promise<void> {
  const { data: claimed } = await db
    .from('sync_jobs')
    .update({ status: 'running', started_at: new Date().toISOString() })
    .eq('id', jobId)
    .eq('status', 'pending')
    .select('*')
    .maybeSingle();
  if (!claimed) return;

  if (claimed.connected_calendar_id) {
    const { data: other } = await db
      .from('sync_jobs')
      .select('id')
      .eq('connected_calendar_id', claimed.connected_calendar_id)
      .eq('status', 'running')
      .neq('id', jobId)
      .maybeSingle();
    if (other) {
      await db.from('sync_jobs').update({ status: 'pending', started_at: null }).eq('id', jobId);
      return;
    }
  }

  try {
    if (claimed.connected_calendar_id) {
      await syncConnectedCalendar(db, claimed.connected_calendar_id, 'auto');
    } else {
      const { data: calendars } = await db
        .from('connected_calendars')
        .select('id')
        .eq('connection_id', claimed.connection_id)
        .eq('enabled', true);
      for (const cal of calendars ?? []) {
        await syncConnectedCalendar(db, cal.id, 'auto');
      }
    }
    await db.from('sync_jobs').update({ status: 'completed', completed_at: new Date().toISOString() }).eq('id', jobId);
  } catch (err) {
    await db
      .from('sync_jobs')
      .update({ status: 'failed', error: String(err), completed_at: new Date().toISOString() })
      .eq('id', jobId);
    throw err;
  }

  const followId = await nextPendingJob(db, claimed.connection_id, claimed.connected_calendar_id);
  if (followId) await processSyncJob(db, followId);
}

function publicWebhookUrl(raw: string): string {
  const url = new URL(raw);
  if (url.protocol !== 'https:') throw new Error('webhook_url_must_be_https');
  if (url.hostname === 'localhost' || url.hostname === '127.0.0.1') {
    throw new Error('webhook_url_not_public');
  }
  return url.toString();
}

function googleWatchAddress(): string {
  const url = new URL(publicWebhookUrl(env('GOOGLE_WEBHOOK_URL')));
  const anon = envOptional('SUPABASE_ANON_KEY') ?? envOptional('SUPABASE_ANON_KEY');
  if (anon && !url.searchParams.has('apikey')) url.searchParams.set('apikey', anon);
  return url.toString();
}

function watchLog(provider: ProviderName): string {
  return provider === 'GOOGLE' ? '[google-watch]' : '[microsoft-subscription]';
}

export async function ensureWebhook(db: SupabaseClient, calendarId: string): Promise<void> {
  const { ctx, calendar } = await loadSyncContext(db, calendarId);
  if (ctx.provider === 'ICLOUD') {
    logSafe('[icloud-poll] webhook_skipped', { calendarId, reason: 'caldav_no_push' });
    return;
  }
  if (calendar.enabled === false) {
    logSafe(`${watchLog(ctx.provider)} skipped_disabled`, { calendarId });
    return;
  }
  const horizon = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();
  const { data: current } = await db
    .from('webhook_subscriptions')
    .select('*')
    .eq('connected_calendar_id', calendarId)
    .eq('status', 'active')
    .maybeSingle();
  if (current && new Date(current.expires_at) > new Date(horizon)) {
    if (ctx.provider === 'MICROSOFT' || current.last_notification_at) {
      logSafe(`${watchLog(ctx.provider)} already_active`, { calendarId, expiresAt: current.expires_at });
      return;
    }
  }

  const { accessToken, provider } = await getValidAccessToken(db, ctx.connectionId);
  const impl = providerFor(provider);
  const webhookUrl = provider === 'GOOGLE'
    ? googleWatchAddress()
    : publicWebhookUrl(functionPublicUrl('microsoft-webhook', envOptional('MICROSOFT_WEBHOOK_URL')));

  if (provider === 'MICROSOFT' && current) {
    try {
      const renewed = await impl.renewWebhookSubscription(accessToken, {
        externalSubscriptionId: current.external_subscription_id,
        externalResourceId: current.external_resource_id ?? undefined,
        expiresAt: current.expires_at,
      }, webhookUrl);
      await db.from('webhook_subscriptions').update({ expires_at: renewed.expiresAt }).eq('id', current.id);
      logSafe('[microsoft-subscription]', { renewed: true, expires_at: renewed.expiresAt });
      return;
    } catch (err) {
      logSafe('[microsoft-subscription]', {
        renewed: false,
        message: err instanceof Error ? err.message : 'unknown',
      });
    }
  }

  const { data: expiring } = await db
    .from('webhook_subscriptions')
    .select('*')
    .eq('connected_calendar_id', calendarId)
    .eq('status', 'active');
  for (const sub of expiring ?? []) {
    try {
      await impl.deleteWebhookSubscription(accessToken, {
        externalSubscriptionId: sub.external_subscription_id,
        externalResourceId: sub.external_resource_id ?? undefined,
        expiresAt: sub.expires_at,
      });
    } catch {
      /* already gone */
    }
    await db.from('webhook_subscriptions').update({ status: 'expired' }).eq('id', sub.id);
  }

  const clientState = randomHex(16);
  const hash = await sha256Hex(clientState);
  const watch = await impl.createWebhookSubscription(
    accessToken,
    String(calendar.provider_calendar_id),
    webhookUrl,
    clientState,
  );
  await db.from('webhook_subscriptions').insert({
    connection_id: ctx.connectionId,
    connected_calendar_id: calendarId,
    provider,
    external_subscription_id: watch.externalSubscriptionId,
    external_resource_id: watch.externalResourceId ?? null,
    client_state_hash: hash,
    expires_at: watch.expiresAt,
    status: 'active',
  });
  logSafe('[google-watch] created', {
    calendarId,
    channelPrefix: String(watch.externalSubscriptionId).slice(0, 8),
    expiration: watch.expiresAt,
  });
}

export async function ensureEnabledWatches(
  db: SupabaseClient,
  input: { userId?: string; connectionId?: string },
): Promise<number> {
  let query = db.from('connected_calendars').select('id').eq('enabled', true);
  if (input.userId) query = query.eq('user_id', input.userId);
  if (input.connectionId) query = query.eq('connection_id', input.connectionId);
  const { data: calendars } = await query;
  let armed = 0;
  for (const cal of calendars ?? []) {
    try {
      await ensureWebhook(db, cal.id);
      armed += 1;
    } catch (err) {
      logSafe('[google-watch] ensure_failed', {
        calendarId: cal.id,
        message: err instanceof Error ? err.message : 'unknown',
      });
    }
  }
  return armed;
}

export { createOriginWithOptionalMirrors };
