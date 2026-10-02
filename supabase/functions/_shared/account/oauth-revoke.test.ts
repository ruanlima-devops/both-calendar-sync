import { describe, expect, it, vi } from 'vitest';
import {
  isAuthExternalCleanupError,
  isSafeExternalCleanupError,
  isTransientExternalCleanupError,
  revokeProviderAuthorization,
} from './oauth-revoke.ts';

describe('oauth revoke (account deletion)', () => {
  it('revokes Google token successfully', async () => {
    const fetchImpl = vi.fn(async () => new Response('', { status: 200 }));
    const result = await revokeProviderAuthorization({
      provider: 'GOOGLE',
      token: 'refresh-or-access',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(result).toBe('revoked');
    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(fetchImpl.mock.calls[0]?.[0]).toBe('https://oauth2.googleapis.com/revoke');
  });

  it('treats Google 400 as already_gone', async () => {
    const fetchImpl = vi.fn(async () => new Response('invalid_token', { status: 400 }));
    await expect(
      revokeProviderAuthorization({
        provider: 'GOOGLE',
        token: 'x',
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).resolves.toBe('already_gone');
  });

  it('skips Microsoft revoke pending M3-003 (no false success recreation)', async () => {
    const fetchImpl = vi.fn();
    const result = await revokeProviderAuthorization({
      provider: 'MICROSOFT',
      token: 'x',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(result).toBe('skipped');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('skips empty token', async () => {
    await expect(
      revokeProviderAuthorization({ provider: 'GOOGLE', token: '' }),
    ).resolves.toBe('skipped');
  });

  it('classifies missing external resources as safe', () => {
    expect(isSafeExternalCleanupError(Object.assign(new Error('gone'), { httpStatus: 404 }))).toBe(true);
    expect(isSafeExternalCleanupError(Object.assign(new Error('gone'), { httpStatus: 410 }))).toBe(true);
    expect(isSafeExternalCleanupError(new Error('boom'))).toBe(false);
  });

  it('classifies transient provider failures', () => {
    expect(
      isTransientExternalCleanupError(
        Object.assign(new Error('rate'), { httpStatus: 429, code: 'RATE_LIMITED' }),
      ),
    ).toBe(true);
    expect(
      isTransientExternalCleanupError(
        Object.assign(new Error('down'), { httpStatus: 503, code: 'PROVIDER_UNAVAILABLE' }),
      ),
    ).toBe(true);
    expect(
      isTransientExternalCleanupError(Object.assign(new Error('timeout'), { code: 'TIMEOUT' })),
    ).toBe(true);
    expect(isTransientExternalCleanupError(Object.assign(new Error('gone'), { httpStatus: 404 }))).toBe(
      false,
    );
  });

  it('classifies auth cleanup failures', () => {
    expect(
      isAuthExternalCleanupError(Object.assign(new Error('auth'), { httpStatus: 401, code: 'AUTH_REQUIRED' })),
    ).toBe(true);
    expect(
      isAuthExternalCleanupError(
        Object.assign(new Error('perm'), { httpStatus: 403, code: 'PERMISSION_ERROR' }),
      ),
    ).toBe(true);
  });

  it('returns failed on Google revoke 5xx without throwing', async () => {
    const fetchImpl = vi.fn(async () => new Response('err', { status: 500 }));
    await expect(
      revokeProviderAuthorization({
        provider: 'GOOGLE',
        token: 'x',
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).resolves.toBe('failed');
  });
});
