import { describe, expect, it } from 'vitest';
import { authorizationBearerMatches, cronSecretMatches } from './auth-guards.ts';

describe('function auth guards', () => {
  const secret = 'stage-test-secret';

  it('rejects RevenueCat webhook without bearer', () => {
    expect(authorizationBearerMatches(null, secret)).toBe(false);
    expect(authorizationBearerMatches('Bearer ', secret)).toBe(false);
    expect(authorizationBearerMatches('Bearer wrong', secret)).toBe(false);
  });

  it('accepts RevenueCat webhook with matching bearer', () => {
    expect(authorizationBearerMatches(`Bearer ${secret}`, secret)).toBe(true);
  });

  it('rejects cron without secret', () => {
    const req = new Request('https://example.local/functions/v1/icloud-poll');
    expect(cronSecretMatches(req, secret)).toBe(false);
    expect(cronSecretMatches(req, undefined)).toBe(false);
  });

  it('accepts cron with x-cron-secret or bearer', () => {
    const headerReq = new Request('https://example.local/functions/v1/renew-subscriptions', {
      headers: { 'x-cron-secret': secret },
    });
    const bearerReq = new Request('https://example.local/functions/v1/reconcile-sync', {
      headers: { Authorization: `Bearer ${secret}` },
    });
    expect(cronSecretMatches(headerReq, secret)).toBe(true);
    expect(cronSecretMatches(bearerReq, secret)).toBe(true);
  });
});
