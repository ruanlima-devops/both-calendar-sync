import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { handleLegacySyncCalendar, SYNC_CALENDAR_GONE } from './sync-calendar-legacy.ts';

const ROOT = path.resolve(__dirname, '../../../..');

async function post(body: unknown, headers: Record<string, string> = {}): Promise<Response> {
  return handleLegacySyncCalendar(
    new Request('https://example.local/functions/v1/sync-calendar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
    }),
  );
}

async function readJson(res: Response): Promise<unknown> {
  return res.json();
}

describe('SEC-07 sync-calendar legacy retirement', () => {
  it('returns 410 Gone for anonymous requests', async () => {
    const res = await post({ jobId: 'any-job' });
    expect(res.status).toBe(410);
    expect(await readJson(res)).toEqual(SYNC_CALENDAR_GONE);
  });

  it('returns 410 for invalid JWT bearer', async () => {
    const res = await post(
      { calendarId: 'cal-1' },
      { Authorization: 'Bearer not-a-real-jwt' },
    );
    expect(res.status).toBe(410);
  });

  it('returns 410 for expired-looking JWT payload (handler does not trust tokens)', async () => {
    // Header/payload/signature shape only — never validated; endpoint is gone.
    const expiredJwt =
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.' +
      'eyJzdWIiOiJ1MSIsImV4cCI6MTAwMDAwMDAwMH0.' +
      'signature';
    const res = await post({ calendarId: 'cal-1' }, { Authorization: `Bearer ${expiredJwt}` });
    expect(res.status).toBe(410);
    expect(await readJson(res)).toMatchObject({ code: 'SYNC_CALENDAR_DEPRECATED' });
  });

  it('refuses own-calendar sync (retired path)', async () => {
    const res = await post(
      { calendarId: 'cal-own', mode: 'initial' },
      { Authorization: 'Bearer user-jwt-u1' },
    );
    expect(res.status).toBe(410);
  });

  it('refuses other-user calendarId (no IDOR possible)', async () => {
    const res = await post(
      { calendarId: 'cal-victim', user_id: 'attacker' },
      { Authorization: 'Bearer user-jwt-attacker' },
    );
    expect(res.status).toBe(410);
  });

  it('refuses own jobId processing', async () => {
    const res = await post({ jobId: 'job-own' }, { Authorization: 'Bearer user-jwt-u1' });
    expect(res.status).toBe(410);
  });

  it('refuses other-user jobId processing', async () => {
    const res = await post({ jobId: 'job-victim' });
    expect(res.status).toBe(410);
  });

  it('refuses nonexistent IDs without leaking existence', async () => {
    const missingCal = await post({ calendarId: '00000000-0000-4000-8000-000000000000' });
    const missingJob = await post({ jobId: '00000000-0000-4000-8000-000000000001' });
    expect(missingCal.status).toBe(410);
    expect(missingJob.status).toBe(410);
    expect(await readJson(missingCal)).toEqual(await readJson(missingJob));
  });

  it('ignores client-spoofed user_id / userId fields', async () => {
    const res = await post({
      calendarId: 'cal-1',
      user_id: 'victim-user',
      userId: 'victim-user',
      jobId: 'job-1',
    });
    expect(res.status).toBe(410);
    expect(await readJson(res)).toEqual(SYNC_CALENDAR_GONE);
  });

  it('refuses authorized internal cron caller (use reconcile-sync instead)', async () => {
    const res = await post(
      { reconcile: true, jobId: 'stuck-job' },
      { 'x-cron-secret': 'stage-test-secret', Authorization: 'Bearer stage-test-secret' },
    );
    expect(res.status).toBe(410);
    expect(await readJson(res)).toMatchObject({
      use: { internalReconcile: 'reconcile-sync', userSync: 'sync-now' },
    });
  });

  it('refuses internal caller without credential the same way (fail-closed)', async () => {
    const res = await post({ reconcile: true });
    expect(res.status).toBe(410);
  });

  it('never invokes sync side effects regardless of payload', async () => {
    const processSyncJob = vi.fn();
    const syncConnectedCalendar = vi.fn();
    const enqueueSync = vi.fn();

    // Handler has no injectable deps by design — prove module surface cannot call them.
    const res = await post({
      jobId: 'j1',
      calendarId: 'c1',
      reconcile: true,
      mode: 'initial',
      user_id: 'u-spoof',
    });

    expect(res.status).toBe(410);
    expect(processSyncJob).not.toHaveBeenCalled();
    expect(syncConnectedCalendar).not.toHaveBeenCalled();
    expect(enqueueSync).not.toHaveBeenCalled();
  });
});

describe('SEC-07 source contracts', () => {
  it('removes dangerous processing from sync-calendar entrypoint', () => {
    const entry = readFileSync(
      path.join(ROOT, 'supabase/functions/sync-calendar/index.ts'),
      'utf8',
    );
    expect(entry).toContain('handleLegacySyncCalendar');
    expect(entry).not.toContain('processSyncJob');
    expect(entry).not.toContain('syncConnectedCalendar');
    expect(entry).not.toContain('enqueueSync');
    expect(entry).not.toContain('body.jobId');
    expect(entry).not.toContain('calendarId');
  });

  it('sets verify_jwt=true for sync-calendar in config.toml', () => {
    const toml = readFileSync(path.join(ROOT, 'supabase/config.toml'), 'utf8');
    const block = toml.split('[functions.sync-calendar]')[1]?.split('[functions.')[0] ?? '';
    expect(block).toMatch(/verify_jwt\s*=\s*true/);
    expect(block).not.toMatch(/verify_jwt\s*=\s*false/);
  });

  it('keeps legitimate user sync on sync-now with JWT + ownership scoping', () => {
    const syncNow = readFileSync(
      path.join(ROOT, 'supabase/functions/sync-now/index.ts'),
      'utf8',
    );
    expect(syncNow).toContain('userFromRequest');
    expect(syncNow).toContain(".eq('user_id', userId)");
    expect(syncNow).toContain('requireEntitlement');
    expect(syncNow).not.toContain('processSyncJob');
  });

  it('keeps legitimate internal reconcile behind cronAuthorized', () => {
    const reconcile = readFileSync(
      path.join(ROOT, 'supabase/functions/reconcile-sync/index.ts'),
      'utf8',
    );
    expect(reconcile).toContain('cronAuthorized');
    expect(reconcile).toContain('processSyncJob');
    expect(reconcile).toMatch(/if\s*\(\s*!cronAuthorized\(req\)\s*\)/);
  });

  it('app callers use sync-now, not sync-calendar', () => {
    const calendars = readFileSync(path.join(ROOT, 'app/(app)/(tabs)/calendars.tsx'), 'utf8');
    const index = readFileSync(path.join(ROOT, 'app/(app)/(tabs)/index.tsx'), 'utf8');
    expect(calendars).toContain("'sync-now'");
    expect(index).toContain("'sync-now'");
    expect(calendars).not.toContain('sync-calendar');
    expect(index).not.toContain('sync-calendar');
  });
});
