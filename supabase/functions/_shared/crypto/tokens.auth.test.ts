import { describe, expect, it } from 'vitest';
import { isAuthRequiredError, mapOAuthError, needsRefresh } from '../crypto/tokens.ts';
import { ProviderHttpError } from '../providers/http-retry.ts';

describe('OAuth revocation classification', () => {
  it('maps Google/Microsoft refresh revocation to AUTH_REQUIRED', () => {
    expect(mapOAuthError(400, 'invalid_grant')).toBe('AUTH_REQUIRED');
    expect(mapOAuthError(401, 'invalid_token')).toBe('AUTH_REQUIRED');
    expect(mapOAuthError(400, 'unauthorized_client')).toBe('AUTH_REQUIRED');
    expect(mapOAuthError(400, 'interaction_required')).toBe('AUTH_REQUIRED');
    expect(mapOAuthError(400, 'consent_required')).toBe('AUTH_REQUIRED');
    expect(mapOAuthError(500)).toBe('ERROR');
  });

  it('detects ProviderHttpError 401 as AUTH_REQUIRED (not DEGRADED)', () => {
    const err = new ProviderHttpError({
      message: 'google_http_401',
      httpStatus: 401,
      code: 'AUTH_REQUIRED',
    });
    expect(isAuthRequiredError(err)).toBe(true);
  });

  it('detects oauth status field from refresh failures', () => {
    const err = Object.assign(new Error('invalid_grant'), { status: 'AUTH_REQUIRED' });
    expect(isAuthRequiredError(err)).toBe(true);
  });

  it('detects Microsoft AADSTS revocation codes in messages', () => {
    expect(isAuthRequiredError(new Error('AADSTS50173: The grant was revoked'))).toBe(true);
    expect(isAuthRequiredError(new Error('AADSTS70008: refresh token expired'))).toBe(true);
  });

  it('does not treat rate-limit / outage as AUTH_REQUIRED', () => {
    expect(
      isAuthRequiredError(
        new ProviderHttpError({ message: 'rate limited', httpStatus: 429, code: 'RATE_LIMITED' }),
      ),
    ).toBe(false);
    expect(
      isAuthRequiredError(
        new ProviderHttpError({
          message: 'unavailable',
          httpStatus: 503,
          code: 'PROVIDER_UNAVAILABLE',
        }),
      ),
    ).toBe(false);
    expect(mapOAuthError(503)).toBe('ERROR');
  });

  it('reconnect path: successful token resolution clears AUTH_REQUIRED', () => {
    // getValidAccessToken promotes AUTH_REQUIRED → CONNECTED after usable tokens return.
    expect(needsRefresh(new Date(Date.now() - 1000).toISOString())).toBe(true);
    expect(mapOAuthError(400, 'invalid_grant')).toBe('AUTH_REQUIRED');
    expect(isAuthRequiredError(Object.assign(new Error('ok'), { status: 'AUTH_REQUIRED' }))).toBe(true);
  });
});
