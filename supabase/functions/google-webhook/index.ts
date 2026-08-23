import { sha256Hex, timingSafeEqual } from '../_shared/crypto/tokens.ts';
import { adminClient, handle, json } from '../_shared/function.ts';
import { logSafe } from '../_shared/http.ts';
import { enqueueSync, processSyncJob } from '../_shared/sync/runtime.ts';

function header(req: Request, name: string): string {
  return req.headers.get(name) ?? '';
}

Deno.serve((req) =>
  handle(req, async () => {
    const channelId = header(req, 'X-Goog-Channel-ID');
    const resourceId = header(req, 'X-Goog-Resource-ID');
    const resourceState = header(req, 'X-Goog-Resource-State').toLowerCase();
    const channelToken = header(req, 'X-Goog-Channel-Token');
    const messageNumber = header(req, 'X-Goog-Message-Number') || '0';

    if (!channelId || !resourceId) {
      logSafe('[google-webhook] missing_headers', {});
      return json({ ok: true, ignored: true });
    }

    const db = adminClient();
    const { data: sub } = await db
      .from('webhook_subscriptions')
      .select('id, connection_id, connected_calendar_id, client_state_hash, external_resource_id, status, calendar_connections!inner(user_id)')
      .eq('external_subscription_id', channelId)
      .eq('status', 'active')
      .maybeSingle();

    if (!sub) {
      logSafe('[google-webhook] unknown_channel', { channelPrefix: channelId.slice(0, 8) });
      return json({ ok: true, ignored: true });
    }
    if (sub.external_resource_id && sub.external_resource_id !== resourceId) {
      logSafe('[google-webhook] resource_mismatch', { channelPrefix: channelId.slice(0, 8) });
      return json({ ok: true, ignored: true });
    }

    if (sub.client_state_hash) {
      const incomingHash = await sha256Hex(channelToken);
      if (!timingSafeEqual(incomingHash, sub.client_state_hash as string)) {
        logSafe('[google-webhook] invalid_token', { channelPrefix: channelId.slice(0, 8) });
        return json({ ok: true, ignored: true });
      }
    }

    await db
      .from('webhook_subscriptions')
      .update({ last_notification_at: new Date().toISOString() })
      .eq('id', sub.id);

    if (resourceState === 'sync') {
      logSafe('[google-webhook] received', {
        channelPrefix: channelId.slice(0, 8),
        resourceState: 'sync',
        calendarFound: true,
      });
      return json({ ok: true, sync: true });
    }

    if (resourceState && resourceState !== 'exists') {
      logSafe('[google-webhook] received', {
        channelPrefix: channelId.slice(0, 8),
        resourceState,
        calendarFound: true,
      });
      return json({ ok: true });
    }

    const userId = (sub.calendar_connections as { user_id: string }).user_id;
    const calendarId = sub.connected_calendar_id as string | null;
    logSafe('[google-webhook] received', {
      channelPrefix: channelId.slice(0, 8),
      resourceState: resourceState || 'exists',
      messageNumber,
      calendarFound: Boolean(calendarId),
    });

    if (!calendarId) return json({ ok: true });

    const jobId = await enqueueSync(db, {
      userId,
      connectionId: sub.connection_id,
      calendarId,
      reason: 'google_webhook',
      dedupeKey: `google:${calendarId}:${messageNumber}`,
    });
    const started = Date.now();
    await processSyncJob(db, jobId);
    logSafe('[google-sync]', {
      mode: 'incremental',
      durationMs: Date.now() - started,
    });
    return json({ ok: true });
  }),
);
