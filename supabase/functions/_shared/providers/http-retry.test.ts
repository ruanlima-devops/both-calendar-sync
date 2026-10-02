import { describe, expect, it, vi } from 'vitest';
import {
  PROVIDER_RETRY_POLICY,
  ProviderHttpError,
  computeBackoffMs,
  googleIdempotentEventId,
  isGoogleQuotaLimit,
  parseRetryAfterHeader,
  providerFetch,
} from './http-retry.ts';
import { toGoogleBody } from './google.ts';
import { toMicrosoftBody } from './microsoft.ts';

function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

describe('parseRetryAfterHeader', () => {
  it('parses delta-seconds and caps huge values', () => {
    expect(parseRetryAfterHeader('5', 15_000)).toBe(5_000);
    expect(parseRetryAfterHeader('0', 15_000)).toBe(0);
    expect(parseRetryAfterHeader('99999', 15_000)).toBe(15_000);
  });

  it('rejects invalid / negative', () => {
    expect(parseRetryAfterHeader('nope', 15_000)).toBeNull();
    expect(parseRetryAfterHeader('-1', 15_000)).toBeNull();
    expect(parseRetryAfterHeader('', 15_000)).toBeNull();
    expect(parseRetryAfterHeader(null, 15_000)).toBeNull();
  });

  it('parses HTTP-date relative to now', () => {
    const now = Date.parse('Wed, 08 Sep 2026 03:00:00 GMT');
    const header = 'Wed, 08 Sep 2026 03:00:04 GMT';
    expect(parseRetryAfterHeader(header, 15_000, now)).toBe(4_000);
  });
});

describe('computeBackoffMs + jitter', () => {
  it('stays within expected bands for attempts', () => {
    const policy = PROVIDER_RETRY_POLICY;
    const d0 = computeBackoffMs(0, policy, () => 0);
    const d1 = computeBackoffMs(1, policy, () => 1);
    const d2 = computeBackoffMs(2, policy, () => 0.5);
    expect(d0).toBeGreaterThanOrEqual(policy.baseDelayMs);
    expect(d0).toBeLessThanOrEqual(policy.baseDelayMs * 2);
    expect(d1).toBeGreaterThanOrEqual(policy.baseDelayMs * 2);
    expect(d1).toBeLessThanOrEqual(policy.maxDelayMs);
    expect(d2).toBeLessThanOrEqual(policy.maxDelayMs);
  });
});

describe('isGoogleQuotaLimit', () => {
  it('detects usageLimits / rateLimitExceeded', () => {
    expect(
      isGoogleQuotaLimit(403, {
        error: { errors: [{ domain: 'usageLimits', reason: 'rateLimitExceeded' }], message: 'Rate Limit Exceeded' },
      }),
    ).toBe(true);
    expect(
      isGoogleQuotaLimit(403, {
        error: { errors: [{ reason: 'userRateLimitExceeded' }] },
      }),
    ).toBe(true);
  });

  it('does not treat permission 403 as quota', () => {
    expect(
      isGoogleQuotaLimit(403, {
        error: { errors: [{ reason: 'forbidden' }], message: 'The user must be signed up for Google Calendar.' },
      }),
    ).toBe(false);
  });
});

describe('providerFetch', () => {
  it('returns 200 without retry', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { ok: true }));
    const sleep = vi.fn();
    const result = await providerFetch({
      provider: 'GOOGLE',
      operation: 'list_events',
      safety: 'read',
      url: 'https://example.test/events',
      deps: { fetch: fetchMock, sleep, random: () => 0, now: () => 0 },
    });
    expect(result.body).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it('retries Google 429 then succeeds', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(429, { error: { message: 'rate' } }))
      .mockResolvedValueOnce(jsonResponse(200, { items: [] }));
    const sleep = vi.fn().mockResolvedValue(undefined);
    const result = await providerFetch({
      provider: 'GOOGLE',
      operation: 'list_events',
      safety: 'read',
      url: 'https://example.test/events',
      deps: { fetch: fetchMock, sleep, random: () => 0, now: () => 0 },
    });
    expect(result.body).toEqual({ items: [] });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledTimes(1);
  });

  it('retries Google 403 usageLimits then succeeds', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse(403, { error: { errors: [{ reason: 'rateLimitExceeded', domain: 'usageLimits' }] } }),
      )
      .mockResolvedValueOnce(jsonResponse(200, { items: [1] }));
    const sleep = vi.fn().mockResolvedValue(undefined);
    const result = await providerFetch({
      provider: 'GOOGLE',
      operation: 'list_events',
      safety: 'read',
      url: 'https://example.test/events',
      deps: { fetch: fetchMock, sleep, random: () => 0, now: () => 0 },
    });
    expect(result.body).toEqual({ items: [1] });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does not retry permission 403', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(403, { error: { errors: [{ reason: 'forbidden' }], message: 'forbidden' } }),
    );
    const sleep = vi.fn();
    await expect(
      providerFetch({
        provider: 'GOOGLE',
        operation: 'list_events',
        safety: 'read',
        url: 'https://example.test/events',
        deps: { fetch: fetchMock, sleep, random: () => 0, now: () => 0 },
      }),
    ).rejects.toMatchObject({ code: 'PERMISSION_ERROR', httpStatus: 403 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it('does not retry 401 / 400', async () => {
    const sleep = vi.fn();
    await expect(
      providerFetch({
        provider: 'MICROSOFT',
        operation: 'list_events',
        safety: 'read',
        url: 'https://example.test',
        deps: {
          fetch: vi.fn().mockResolvedValue(jsonResponse(401, { error: { message: 'Unauthorized' } })),
          sleep,
          random: () => 0,
          now: () => 0,
        },
      }),
    ).rejects.toMatchObject({ code: 'AUTH_REQUIRED' });

    await expect(
      providerFetch({
        provider: 'GOOGLE',
        operation: 'create_event',
        safety: 'create',
        url: 'https://example.test',
        deps: {
          fetch: vi.fn().mockResolvedValue(jsonResponse(400, { error: { message: 'bad' } })),
          sleep,
          random: () => 0,
          now: () => 0,
        },
      }),
    ).rejects.toMatchObject({ code: 'PROVIDER_ERROR' });
    expect(sleep).not.toHaveBeenCalled();
  });

  it('respects Retry-After on Microsoft 429 without sleeping real seconds', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(429, { error: { message: 'throttled' } }, { 'Retry-After': '3' }))
      .mockResolvedValueOnce(jsonResponse(200, { value: [] }));
    const sleep = vi.fn().mockResolvedValue(undefined);
    await providerFetch({
      provider: 'MICROSOFT',
      operation: 'list_events',
      safety: 'read',
      url: 'https://graph.test/events',
      deps: { fetch: fetchMock, sleep, random: () => 0, now: () => 0 },
    });
    expect(sleep).toHaveBeenCalledWith(3_000);
  });

  it('retries Microsoft 503 with Retry-After', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(503, { error: { message: 'unavailable' } }, { 'Retry-After': '1' }))
      .mockResolvedValueOnce(jsonResponse(200, { value: [] }));
    const sleep = vi.fn().mockResolvedValue(undefined);
    await providerFetch({
      provider: 'MICROSOFT',
      operation: 'list_events',
      safety: 'read',
      url: 'https://graph.test/events',
      deps: { fetch: fetchMock, sleep, random: () => 0, now: () => 0 },
    });
    expect(sleep).toHaveBeenCalledWith(1_000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('retries 502/504 for reads', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(502, { error: { message: 'bad gateway' } }))
      .mockResolvedValueOnce(jsonResponse(504, { error: { message: 'timeout' } }))
      .mockResolvedValueOnce(jsonResponse(200, { ok: 1 }));
    const sleep = vi.fn().mockResolvedValue(undefined);
    const result = await providerFetch({
      provider: 'GOOGLE',
      operation: 'list_events',
      safety: 'read',
      url: 'https://example.test',
      deps: { fetch: fetchMock, sleep, random: () => 0, now: () => 0 },
    });
    expect(result.body).toEqual({ ok: 1 });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('exhausts bounded 429 retries', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(429, { error: { message: 'rate' } }));
    const sleep = vi.fn().mockResolvedValue(undefined);
    await expect(
      providerFetch({
        provider: 'GOOGLE',
        operation: 'list_events',
        safety: 'read',
        url: 'https://example.test',
        policy: { ...PROVIDER_RETRY_POLICY, maxAttempts: 3 },
        deps: { fetch: fetchMock, sleep, random: () => 0, now: () => 0 },
      }),
    ).rejects.toBeInstanceOf(ProviderHttpError);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it('retries network errors for reads but not for create', async () => {
    const sleep = vi.fn().mockResolvedValue(undefined);
    const network = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockResolvedValueOnce(jsonResponse(200, { ok: true }));
    await providerFetch({
      provider: 'GOOGLE',
      operation: 'list_events',
      safety: 'read',
      url: 'https://example.test',
      deps: { fetch: network, sleep, random: () => 0, now: () => 0 },
    });
    expect(network).toHaveBeenCalledTimes(2);

    const createFetch = vi.fn().mockRejectedValue(new TypeError('fetch failed'));
    await expect(
      providerFetch({
        provider: 'MICROSOFT',
        operation: 'create_event',
        safety: 'create',
        url: 'https://example.test',
        deps: { fetch: createFetch, sleep, random: () => 0, now: () => 0 },
      }),
    ).rejects.toMatchObject({ code: 'NETWORK_ERROR' });
    expect(createFetch).toHaveBeenCalledTimes(1);
  });

  it('retries timeout for reads', async () => {
    const sleep = vi.fn().mockResolvedValue(undefined);
    const abortErr = new Error('aborted');
    abortErr.name = 'AbortError';
    const fetchMock = vi.fn().mockRejectedValueOnce(abortErr).mockResolvedValueOnce(jsonResponse(200, { ok: true }));
    await providerFetch({
      provider: 'GOOGLE',
      operation: 'list_events',
      safety: 'read',
      url: 'https://example.test',
      deps: { fetch: fetchMock, sleep, random: () => 0, now: () => 0 },
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('allows 429 retry for create but not 503', async () => {
    const sleep = vi.fn().mockResolvedValue(undefined);
    const rateThenOk = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(429, { error: { message: 'rate' } }))
      .mockResolvedValueOnce(jsonResponse(200, { id: 'e1' }));
    await providerFetch({
      provider: 'MICROSOFT',
      operation: 'create_event',
      safety: 'create',
      url: 'https://example.test',
      deps: { fetch: rateThenOk, sleep, random: () => 0, now: () => 0 },
    });
    expect(rateThenOk).toHaveBeenCalledTimes(2);

    const unavailable = vi.fn().mockResolvedValue(jsonResponse(503, { error: { message: 'down' } }));
    await expect(
      providerFetch({
        provider: 'MICROSOFT',
        operation: 'create_event',
        safety: 'create',
        url: 'https://example.test',
        deps: { fetch: unavailable, sleep, random: () => 0, now: () => 0 },
      }),
    ).rejects.toMatchObject({ code: 'PROVIDER_UNAVAILABLE', httpStatus: 503 });
    expect(unavailable).toHaveBeenCalledTimes(1);
  });

  it('treats delete 404 as success when notFoundOk', async () => {
    const result = await providerFetch({
      provider: 'GOOGLE',
      operation: 'delete_event',
      safety: 'idempotent_write',
      url: 'https://example.test/event',
      notFoundOk: true,
      deps: {
        fetch: vi.fn().mockResolvedValue(new Response(null, { status: 404 })),
        sleep: vi.fn(),
        random: () => 0,
        now: () => 0,
      },
    });
    expect(result.status).toBe(404);
  });
});

describe('create safety', () => {
  it('Google create always assigns an insert id suitable for idempotent retries', () => {
    const body = toGoogleBody({
      title: 't',
      startAt: '2026-09-15T12:00:00.000Z',
      endAt: '2026-09-15T13:00:00.000Z',
      allDay: false,
      timezone: 'UTC',
      role: 'MIRROR',
      syncGroupId: 'f1940169-1111-4111-8111-000000000001',
    });
    expect(body.id).toBeUndefined();
    const id = googleIdempotentEventId('11111111-2222-4333-8444-555555555555');
    expect(id).toMatch(/^[a-v0-9]{5,1024}$/);
    expect(id).toBe('11111111222243338444555555555555');
  });

  it('Microsoft create body has no Graph idempotency key (classified create-only retries)', () => {
    const body = toMicrosoftBody({
      title: 't',
      startAt: '2026-09-15T12:00:00.000Z',
      endAt: '2026-09-15T13:00:00.000Z',
      allDay: false,
      timezone: 'UTC',
      role: 'EXTERNAL',
    });
    expect(body).not.toHaveProperty('transactionId');
    expect(JSON.stringify(body)).not.toContain('Idempotency-Key');
  });

  it('idempotent_write retries 503 for update/delete paths', async () => {
    const sleep = vi.fn().mockResolvedValue(undefined);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(503, { error: { message: 'down' } }))
      .mockResolvedValueOnce(jsonResponse(200, { id: 'ok' }));
    await providerFetch({
      provider: 'GOOGLE',
      operation: 'update_event',
      safety: 'idempotent_write',
      url: 'https://example.test',
      deps: { fetch: fetchMock, sleep, random: () => 0, now: () => 0 },
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('subscription_create does not retry 503 (duplicate watch risk)', async () => {
    const sleep = vi.fn();
    await expect(
      providerFetch({
        provider: 'GOOGLE',
        operation: 'watch_create',
        safety: 'subscription_create',
        url: 'https://example.test/watch',
        deps: {
          fetch: vi.fn().mockResolvedValue(jsonResponse(503, { error: { message: 'down' } })),
          sleep,
          random: () => 0,
          now: () => 0,
        },
      }),
    ).rejects.toMatchObject({ httpStatus: 503 });
    expect(sleep).not.toHaveBeenCalled();
  });
});
