import { adminClient, handle, json, userFromRequest } from '../_shared/function.ts';
import { requireEntitlement } from '../_shared/billing/entitlement.ts';
import { encryptSecret } from '../_shared/crypto/tokens.ts';
import { logSafe } from '../_shared/http.ts';
import { discoverIcloud } from '../_shared/providers/icloud/mod.ts';
import { ICLOUD_CALDAV } from '../_shared/providers/icloud/config.ts';
import { encryptionKey, syncConnectedCalendar, track } from '../_shared/sync/runtime.ts';

function normalizeAppPassword(raw: string): string {
  return raw.replace(/\s+/g, '').replace(/-/g, '');
}

Deno.serve((req) =>
  handle(req, async () => {
    const { userId } = await userFromRequest(req);
    const db = adminClient();
    await requireEntitlement(db, userId);

    const body = (await req.json().catch(() => ({}))) as {
      action?: 'connect' | 'update_credential';
      appleEmail?: string;
      appSpecificPassword?: string;
      connectionId?: string;
    };

    const email = String(body.appleEmail ?? '').trim().toLowerCase();
    const password = normalizeAppPassword(String(body.appSpecificPassword ?? ''));
    if (!email.includes('@')) throw new Error('icloud_email_required');
    if (password.length < 12) throw new Error('icloud_password_required');

    logSafe('[icloud-connect]', { phase: 'start', hasEmail: true });

    let discovery;
    try {
      discovery = await discoverIcloud({ email, password });
    } catch (err) {
      const message = String(err);
      logSafe('[icloud-connect]', { phase: 'auth_failed', code: message.slice(0, 64) });
      if (message.includes('icloud_auth_failed') || message.includes('401')) {
        throw new Error('icloud_auth_failed');
      }
      if (message.includes('timeout')) throw new Error('icloud_timeout');
      if (message.includes('no_calendars')) throw new Error('icloud_no_calendars');
      throw new Error('icloud_connect_failed');
    }

    logSafe('[icloud-connect]', {
      authenticated: true,
      principal_found: true,
      calendars: discovery.calendars.length,
    });

    const key = encryptionKey();
    const encryptedPassword = await encryptSecret(password, key);
    const now = new Date().toISOString();
    const nextSync = new Date(Date.now() + 5_000).toISOString();

    let connectionId = body.connectionId;

    if (body.action === 'update_credential' && connectionId) {
      const { data: existing } = await db
        .from('calendar_connections')
        .select('id')
        .eq('id', connectionId)
        .eq('user_id', userId)
        .eq('provider', 'ICLOUD')
        .maybeSingle();
      if (!existing) throw new Error('connection_not_found');

      await db
        .from('calendar_connections')
        .update({
          account_email: email,
          provider_account_id: email,
          status: 'CONNECTED',
          last_sync_error: null,
          caldav_principal_url: discovery.principalUrl,
          caldav_calendar_home_url: discovery.calendarHomeUrl,
          consecutive_sync_failures: 0,
          poll_interval_seconds: ICLOUD_CALDAV.pollActiveSeconds,
          next_sync_at: nextSync,
        })
        .eq('id', connectionId);

      await db.from('calendar_secrets').upsert({
        connection_id: connectionId,
        encrypted_refresh_token: encryptedPassword,
        encrypted_access_token: null,
        token_expires_at: new Date(Date.now() + 30 * 86400_000).toISOString(),
      });
    } else {
      const { data: existing } = await db
        .from('calendar_connections')
        .select('id')
        .eq('user_id', userId)
        .eq('provider', 'ICLOUD')
        .maybeSingle();

      if (existing) {
        connectionId = existing.id;
        await db
          .from('calendar_connections')
          .update({
            account_email: email,
            provider_account_id: email,
            status: 'CONNECTED',
            last_sync_error: null,
            caldav_principal_url: discovery.principalUrl,
            caldav_calendar_home_url: discovery.calendarHomeUrl,
            consecutive_sync_failures: 0,
            poll_interval_seconds: ICLOUD_CALDAV.pollActiveSeconds,
            next_sync_at: nextSync,
          })
          .eq('id', connectionId);
        await db.from('calendar_secrets').upsert({
          connection_id: connectionId,
          encrypted_refresh_token: encryptedPassword,
          encrypted_access_token: null,
          token_expires_at: new Date(Date.now() + 30 * 86400_000).toISOString(),
        });
      } else {
        const { data: created, error } = await db
          .from('calendar_connections')
          .insert({
            user_id: userId,
            provider: 'ICLOUD',
            provider_account_id: email,
            account_email: email,
            status: 'CONNECTED',
            caldav_principal_url: discovery.principalUrl,
            caldav_calendar_home_url: discovery.calendarHomeUrl,
            poll_interval_seconds: ICLOUD_CALDAV.pollActiveSeconds,
            next_sync_at: nextSync,
            last_sync_at: null,
          })
          .select('id')
          .single();
        if (error || !created) throw new Error(error?.message ?? 'icloud_connect_failed');
        connectionId = created.id;
        await db.from('calendar_secrets').insert({
          connection_id: connectionId,
          encrypted_refresh_token: encryptedPassword,
          encrypted_access_token: null,
          token_expires_at: new Date(Date.now() + 30 * 86400_000).toISOString(),
        });
        await track(db, userId, 'icloud_connected');
      }
    }

    // Upsert calendars from discovery
    for (const cal of discovery.calendars) {
      const { data: row } = await db
        .from('connected_calendars')
        .select('id')
        .eq('connection_id', connectionId!)
        .eq('provider_calendar_id', cal.href)
        .maybeSingle();

      if (row) {
        await db
          .from('connected_calendars')
          .update({
            name: cal.displayName,
            color: cal.color || '#000000',
            access_role: cal.accessRole,
            is_primary: cal.isPrimary,
            updated_at: now,
          })
          .eq('id', row.id);
      } else {
        await db.from('connected_calendars').insert({
          user_id: userId,
          connection_id: connectionId,
          provider_calendar_id: cal.href,
          name: cal.displayName,
          color: cal.color || '#000000',
          timezone: null,
          is_primary: cal.isPrimary,
          enabled: cal.isPrimary,
          access_role: cal.accessRole,
        });
      }
    }

    // Initial sync for enabled calendars
    const { data: enabled } = await db
      .from('connected_calendars')
      .select('id')
      .eq('connection_id', connectionId!)
      .eq('enabled', true);

    const syncResults: Array<{ calendarId: string; imported?: number; error?: string }> = [];
    for (const cal of enabled ?? []) {
      try {
        const result = await syncConnectedCalendar(db, cal.id, 'initial');
        syncResults.push({ calendarId: cal.id, imported: result.imported });
      } catch (err) {
        syncResults.push({ calendarId: cal.id, error: String(err).slice(0, 120) });
      }
    }

    logSafe('[icloud-connect]', { phase: 'connected', calendars: discovery.calendars.length });

    return json({
      ok: true,
      connectionId,
      accountEmail: email,
      calendars: discovery.calendars.map((c) => ({
        name: c.displayName,
        accessRole: c.accessRole,
        isPrimary: c.isPrimary,
      })),
      syncResults,
    });
  }),
);
