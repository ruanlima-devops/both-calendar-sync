import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import type { DigestEvent, DigestPeriod, DigestType } from './digest.ts';
import { periodFor, shouldSendDigest } from './digest.ts';
import { accountPreferencesUrl, appBaseUrl, sendEmail } from './send.ts';
import { digestHtml, digestSubject, digestText } from './templates.ts';
import { logSafe } from '../http.ts';
import { getEntitlement } from '../billing/entitlement.ts';

interface ProfileRow {
  id: string;
  display_name: string | null;
  timezone: string;
  email_weekly_digest: boolean;
  email_monthly_digest: boolean;
}

export async function processDigests(
  db: SupabaseClient,
  input: {
    types: DigestType[];
    now?: Date;
    userId?: string;
    force?: boolean;
    dryRun?: boolean;
  },
): Promise<{ sent: number; skipped: number; errors: string[] }> {
  const now = input.now ?? new Date();
  let sent = 0;
  let skipped = 0;
  const errors: string[] = [];

  let query = db
    .from('profiles')
    .select('id, display_name, timezone, email_weekly_digest, email_monthly_digest')
    .not('onboarding_completed_at', 'is', null);

  if (input.userId) query = query.eq('id', input.userId);

  const { data: profiles, error } = await query;
  if (error) throw new Error(error.message);

  for (const profile of (profiles ?? []) as ProfileRow[]) {
    const entitlement = await getEntitlement(db, profile.id);
    if (!entitlement.hasAccess) {
      skipped += 1;
      continue;
    }

    for (const type of input.types) {
      const enabled = type === 'weekly' ? profile.email_weekly_digest : profile.email_monthly_digest;
      if (!enabled) {
        skipped += 1;
        continue;
      }
      if (!input.force && !shouldSendDigest(type, now, profile.timezone || 'UTC')) {
        skipped += 1;
        continue;
      }

      try {
        const result = await sendDigestForUser(db, profile, type, now, input.dryRun);
        if (result === 'sent') sent += 1;
        else skipped += 1;
      } catch (err) {
        errors.push(`${profile.id}:${type}:${err instanceof Error ? err.message : 'unknown'}`);
      }
    }
  }

  return { sent, skipped, errors };
}

async function sendDigestForUser(
  db: SupabaseClient,
  profile: ProfileRow,
  type: DigestType,
  now: Date,
  dryRun?: boolean,
): Promise<'sent' | 'skipped'> {
  const period = periodFor(type, now, profile.timezone || 'UTC');

  const { data: existing } = await db
    .from('email_digest_log')
    .select('id')
    .eq('user_id', profile.id)
    .eq('digest_type', type)
    .eq('period_start', period.periodStart)
    .eq('period_end', period.periodEnd)
    .maybeSingle();
  if (existing) return 'skipped';

  const { data: authUser } = await db.auth.admin.getUserById(profile.id);
  const email = authUser.user?.email;
  if (!email) return 'skipped';

  const events = await loadEvents(db, profile.id, period);
  const { count: calendarCount } = await db
    .from('connected_calendars')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', profile.id)
    .eq('enabled', true);

  const templateInput = {
    period,
    events,
    timezone: profile.timezone || 'UTC',
    displayName: profile.display_name,
    appUrl: appBaseUrl(),
    activeCalendars: calendarCount ?? 0,
    preferencesUrl: accountPreferencesUrl(),
  };

  const payload = {
    to: email,
    subject: digestSubject(templateInput),
    html: digestHtml(templateInput),
    text: digestText(templateInput),
  };

  if (dryRun) {
    logSafe('digest_dry_run', { userId: profile.id, type, events: events.length });
    return 'skipped';
  }

  const delivery = await sendEmail(payload);
  if (delivery.skipped) {
    logSafe('digest_not_sent_no_provider', { userId: profile.id, type });
    return 'skipped';
  }

  const { error: logError } = await db.from('email_digest_log').insert({
    user_id: profile.id,
    digest_type: type,
    period_start: period.periodStart,
    period_end: period.periodEnd,
  });
  if (logError) throw new Error(logError.message);

  logSafe('digest_sent', { userId: profile.id, type, events: events.length });
  return 'sent';
}

async function loadEvents(
  db: SupabaseClient,
  userId: string,
  period: DigestPeriod,
): Promise<DigestEvent[]> {
  const { data, error } = await db
    .from('calendar_events')
    .select('title, start_at, end_at, all_day, timezone, status')
    .eq('user_id', userId)
    .neq('status', 'cancelled')
    .gte('start_at', period.periodStartUtc)
    .lt('start_at', period.periodEndUtc)
    .order('start_at', { ascending: true });
  if (error) throw new Error(error.message);

  return (data ?? []).map((row) => ({
    title: String(row.title ?? '(sem título)'),
    startAt: String(row.start_at),
    endAt: String(row.end_at),
    allDay: Boolean(row.all_day),
    timezone: String(row.timezone ?? 'UTC'),
  }));
}

export function renderDigestPreview(
  type: DigestType,
  timezone: string,
  events: DigestEvent[],
  displayName: string | null,
): { subject: string; html: string; text: string } {
  const period = periodFor(type, new Date(), timezone);
  const input = {
    period,
    events,
    timezone,
    displayName,
    appUrl: appBaseUrl(),
    activeCalendars: 1,
    preferencesUrl: accountPreferencesUrl(),
  };
  return {
    subject: digestSubject(input),
    html: digestHtml(input),
    text: digestText(input),
  };
}
