import { sha256Hex, timingSafeEqual } from '../_shared/crypto/tokens.ts';
import { adminClient, handle, json, text } from '../_shared/function.ts';
import { logSafe } from '../_shared/http.ts';
import { microsoftValidationToken } from '../_shared/providers/microsoft.ts';
import { enqueueSync, processSyncJob } from '../_shared/sync/runtime.ts';

Deno.serve((req) =>
  handle(req, async () => {
    const url = new URL(req.url);
    const validationToken = microsoftValidationToken(url);
    if (validationToken) {
      logSafe('[microsoft-webhook] validation', { ok: true });
      return text(validationToken, 200, 'text/plain; charset=utf-8');
    }

    const payload = await req.json().catch(() => ({}));
    const notifications = ((payload as { value?: Array<Record<string, unknown>> }).value ?? []);
    const db = adminClient();
    const seen = new Set<string>();

    logSafe('[microsoft-webhook]', { notifications: notifications.length });

    for (const notification of notifications) {
      const subscriptionId = String(notification.subscriptionId ?? '');
      const clientState = String(notification.clientState ?? '');
      const lifecycle = notification.lifecycleEvent as string | undefined;
      const { data: sub } = await db
        .from('webhook_subscriptions')
        .select('id, connection_id, connected_calendar_id, client_state_hash, calendar_connections!inner(user_id)')
        .eq('external_subscription_id', subscriptionId)
        .eq('status', 'active')
        .maybeSingle();

      if (!sub) {
        logSafe('[microsoft-webhook] unknown_subscription', { subscription: subscriptionId.slice(0, 8) });
        continue;
      }
      if (sub.client_state_hash) {
        const incomingHash = await sha256Hex(clientState);
        if (!timingSafeEqual(incomingHash, sub.client_state_hash as string)) {
          logSafe('[microsoft-webhook] client_state_valid', { client_state_valid: false, subscription: subscriptionId.slice(0, 8) });
          continue;
        }
      }

      await db
        .from('webhook_subscriptions')
        .update({ last_notification_at: new Date().toISOString() })
        .eq('id', sub.id);

      const calendarId = sub.connected_calendar_id as string | null;
      if (!calendarId || seen.has(calendarId)) continue;
      seen.add(calendarId);

      const userId = (sub.calendar_connections as { user_id: string }).user_id;
      logSafe('[microsoft-webhook]', {
        subscription: subscriptionId.slice(0, 8),
        client_state_valid: true,
        lifecycle: lifecycle ?? null,
      });

      const jobId = await enqueueSync(db, {
        userId,
        connectionId: sub.connection_id,
        calendarId,
        reason: lifecycle ? `microsoft_${lifecycle}` : 'microsoft_webhook',
        dedupeKey: `ms:${calendarId}:${lifecycle ?? String(notification.changeType ?? 'change')}:${Date.now()}`,
      });
      await processSyncJob(db, jobId);
    }

    return json({ ok: true });
  }),
);
