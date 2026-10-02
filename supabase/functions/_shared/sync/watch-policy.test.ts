import { describe, expect, it } from 'vitest';
import { GOOGLE_WATCH_CONFIRM_GRACE_MS, shouldKeepActiveWatch, WATCH_RENEW_HORIZON_MS } from './watch-policy.ts';

const now = Date.parse('2026-09-30T12:00:00Z');
const iso = (offsetMs: number) => new Date(now + offsetMs).toISOString();
const farExpiry = iso(6 * 24 * 60 * 60 * 1000);

describe('shouldKeepActiveWatch', () => {
  it('keeps a Google channel created seconds ago even before its sync notification (no duplicate on connect)', () => {
    expect(shouldKeepActiveWatch({ provider: 'GOOGLE', expiresAt: farExpiry, createdAt: iso(-1000), lastNotificationAt: null, now })).toBe(true);
  });

  it('keeps a confirmed Google channel', () => {
    expect(shouldKeepActiveWatch({ provider: 'GOOGLE', expiresAt: farExpiry, createdAt: iso(-86_400_000), lastNotificationAt: iso(-60_000), now })).toBe(true);
  });

  it('recreates a Google channel that never received a notification after the grace window', () => {
    expect(
      shouldKeepActiveWatch({ provider: 'GOOGLE', expiresAt: farExpiry, createdAt: iso(-GOOGLE_WATCH_CONFIRM_GRACE_MS - 1), lastNotificationAt: null, now }),
    ).toBe(false);
    expect(shouldKeepActiveWatch({ provider: 'GOOGLE', expiresAt: farExpiry, createdAt: null, lastNotificationAt: null, now })).toBe(false);
  });

  it('renews anything expiring inside the horizon', () => {
    const soon = iso(WATCH_RENEW_HORIZON_MS - 1000);
    expect(shouldKeepActiveWatch({ provider: 'GOOGLE', expiresAt: soon, createdAt: iso(-1000), lastNotificationAt: iso(-10), now })).toBe(false);
    expect(shouldKeepActiveWatch({ provider: 'MICROSOFT', expiresAt: soon, createdAt: iso(-1000), now })).toBe(false);
  });

  it('keeps a Microsoft subscription that is not about to expire, notified or not', () => {
    expect(shouldKeepActiveWatch({ provider: 'MICROSOFT', expiresAt: farExpiry, createdAt: iso(-1000), lastNotificationAt: null, now })).toBe(true);
  });
});
