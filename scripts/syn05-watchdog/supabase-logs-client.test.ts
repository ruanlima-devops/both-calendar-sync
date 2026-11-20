import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  assertValidLogQueryWindow,
  computeQueryWindow,
  FUTURE_END_TOLERANCE_MS,
  MAX_LOG_QUERY_WINDOW_MS,
  SupabaseLogsClient,
} from './supabase-logs-client.ts';
import { STAGE_PROJECT_REF } from './types.ts';

const NOW = Date.parse('2026-11-18T18:00:00.000Z');
const WIN = {
  iso_timestamp_start: '2026-11-18T17:00:00.000Z',
  iso_timestamp_end: '2026-11-18T18:00:00.000Z',
};

function jsonResponse(status: number, body: unknown, headers?: Record<string, string>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

function client(fetchImpl: typeof fetch, extra?: Partial<ConstructorParameters<typeof SupabaseLogsClient>[0]>) {
  return new SupabaseLogsClient({
    accessToken: 'token-token',
    fetchImpl,
    sleep: async () => {},
    now: () => NOW,
    ...extra,
  });
}

describe('assertValidLogQueryWindow', () => {
  it('accepts normal 15m+2m window', () => {
    const w = computeQueryWindow({ nowMs: NOW, windowMs: 15 * 60_000, overlapMs: 2 * 60_000 });
    expect(() => assertValidLogQueryWindow(w.start, w.end, NOW)).not.toThrow();
    expect(Date.parse(w.end) - Date.parse(w.start)).toBe(17 * 60_000);
  });

  it('accepts exactly 24h', () => {
    const start = new Date(NOW - MAX_LOG_QUERY_WINDOW_MS).toISOString();
    const end = new Date(NOW).toISOString();
    expect(() => assertValidLogQueryWindow(start, end, NOW)).not.toThrow();
  });

  it('rejects > 24h', () => {
    const start = new Date(NOW - MAX_LOG_QUERY_WINDOW_MS - 1).toISOString();
    const end = new Date(NOW).toISOString();
    expect(() => assertValidLogQueryWindow(start, end, NOW)).toThrow(/exceeds_24h/);
  });

  it('rejects from >= to and zero duration', () => {
    expect(() => assertValidLogQueryWindow(WIN.iso_timestamp_end, WIN.iso_timestamp_start, NOW)).toThrow(
      /time_window_order/,
    );
    expect(() =>
      assertValidLogQueryWindow(WIN.iso_timestamp_end, WIN.iso_timestamp_end, NOW),
    ).toThrow(/time_window_order/);
  });

  it('rejects invalid timestamps', () => {
    expect(() => assertValidLogQueryWindow('not-a-date', WIN.iso_timestamp_end, NOW)).toThrow(
      /time_window_invalid/,
    );
  });

  it('rejects end far in the future beyond tolerance', () => {
    const end = new Date(NOW + FUTURE_END_TOLERANCE_MS + 60_000).toISOString();
    const start = new Date(NOW).toISOString();
    expect(() => assertValidLogQueryWindow(start, end, NOW)).toThrow(/time_window_end_in_future/);
  });

  it('accepts end within future tolerance', () => {
    const end = new Date(NOW + FUTURE_END_TOLERANCE_MS).toISOString();
    const start = new Date(NOW).toISOString();
    expect(() => assertValidLogQueryWindow(start, end, NOW)).not.toThrow();
  });

  it('accepts timezone offsets (parsed to absolute ms)', () => {
    // 17:00 UTC == 14:00-03:00
    expect(() =>
      assertValidLogQueryWindow('2026-11-18T14:00:00.000-03:00', '2026-11-18T18:00:00.000Z', NOW),
    ).not.toThrow();
  });

  it('rejects missing from/to', () => {
    expect(() => assertValidLogQueryWindow(undefined, WIN.iso_timestamp_end, NOW)).toThrow(
      /time_window_required/,
    );
    expect(() => assertValidLogQueryWindow(WIN.iso_timestamp_start, '', NOW)).toThrow(
      /time_window_required/,
    );
  });
});

describe('SupabaseLogsClient', () => {
  afterEach(() => vi.restoreAllMocks());

  it('rejects non-STAGE project_ref', () => {
    expect(
      () =>
        new SupabaseLogsClient({
          accessToken: 'token-token',
          projectRef: 'sknpqjodttkpttaytdut',
          fetchImpl: vi.fn() as unknown as typeof fetch,
        }),
    ).toThrow(/allowlisted/);
  });

  it('does not call fetch when window invalid', async () => {
    const fetchImpl = vi.fn();
    const c = client(fetchImpl as unknown as typeof fetch);
    await expect(
      c.query({
        source: 'function_edge_logs',
        iso_timestamp_start: '2026-11-01T00:00:00.000Z',
        iso_timestamp_end: '2026-11-18T18:00:00.000Z',
      }),
    ).rejects.toThrow(/exceeds_24h/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('returns complete rows on 200 and dedupes; sanitizes secrets in event_message', async () => {
    const secret = 'Bearer leakedtokenvalue99';
    const fetchImpl = vi.fn(async () =>
      jsonResponse(200, {
        result: [
          {
            timestamp: 't1',
            event_message: `POST | 200 | https://x/functions/v1/reconcile-sync ${secret}`,
            source: 'function_edge_logs',
          },
          {
            timestamp: 't1',
            event_message: `POST | 200 | https://x/functions/v1/reconcile-sync ${secret}`,
            source: 'function_edge_logs',
          },
        ],
      }),
    );
    const res = await client(fetchImpl as unknown as typeof fetch).query({
      source: 'function_edge_logs',
      ...WIN,
      limit: 200,
    });
    expect(res.ok).toBe(true);
    expect(res.completeness).toBe('complete');
    expect(res.truncated).toBe(false);
    expect(res.rows).toHaveLength(1);
    expect(JSON.stringify(res)).not.toContain('leakedtokenvalue99');
    expect(res.rows[0]!.event_message).toContain('POST | 200 |');
    const url = String((fetchImpl.mock.calls as unknown as Array<[unknown]>)[0]![0]);
    expect(url).toContain(STAGE_PROJECT_REF);
    expect(url).toContain('api.supabase.com');
    expect(url).not.toContain('token-token');
  });

  it('treats empty 200 as complete empty', async () => {
    const res = await client(
      (async () => jsonResponse(200, { result: [] })) as unknown as typeof fetch,
    ).query({ source: 'function_logs', ...WIN });
    expect(res.ok).toBe(true);
    expect(res.completeness).toBe('complete');
    expect(res.rows).toEqual([]);
  });

  it('marks truncated as incomplete', async () => {
    const rows = Array.from({ length: 3 }, (_, i) => ({
      timestamp: `t${i}`,
      event_message: `POST | 200 | https://x/functions/v1/reconcile-sync`,
      source: 'function_edge_logs',
    }));
    const res = await client(
      (async () => jsonResponse(200, { result: rows })) as unknown as typeof fetch,
    ).query({ source: 'function_edge_logs', ...WIN, limit: 3 });
    expect(res.truncated).toBe(true);
    expect(res.completeness).toBe('incomplete');
    expect(res.ok).toBe(true);
  });

  it('retries 429 with Retry-After then succeeds', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(429, { message: 'slow' }, { 'retry-after': '0' }))
      .mockResolvedValueOnce(jsonResponse(200, { result: [] }));
    const sleeps: number[] = [];
    const res = await client(fetchImpl as unknown as typeof fetch, {
      sleep: async (ms) => {
        sleeps.push(ms);
      },
      maxRetries: 2,
      baseBackoffMs: 10,
    }).query({ source: 'function_edge_logs', ...WIN });
    expect(res.ok).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(sleeps.length).toBe(1);
  });

  it('exhausts 429 retries as incomplete', async () => {
    const res = await client((async () => jsonResponse(429, {})) as unknown as typeof fetch, {
      maxRetries: 1,
      baseBackoffMs: 1,
    }).query({ source: 'function_edge_logs', ...WIN });
    expect(res.ok).toBe(false);
    expect(res.completeness).toBe('incomplete');
    expect(res.error).toBe('rate_limited');
  });

  it('maps 401/403', async () => {
    const res = await client((async () => jsonResponse(401, {})) as unknown as typeof fetch).query({
      source: 'function_edge_logs',
      ...WIN,
    });
    expect(res.error).toBe('unauthorized');
    expect(res.completeness).toBe('incomplete');
  });

  it('maps 404/410 without fallback', async () => {
    const notFound = await client((async () => jsonResponse(404, {})) as unknown as typeof fetch).query({
      source: 'function_edge_logs',
      ...WIN,
    });
    expect(notFound.error).toBe('not_found');
    const gone = await client((async () => jsonResponse(410, {})) as unknown as typeof fetch).query({
      source: 'function_edge_logs',
      ...WIN,
    });
    expect(gone.error).toBe('endpoint_gone');
  });

  it('retries 5xx then fails incomplete', async () => {
    const res = await client((async () => jsonResponse(503, {})) as unknown as typeof fetch, {
      maxRetries: 0,
    }).query({ source: 'function_edge_logs', ...WIN });
    expect(res.ok).toBe(false);
    expect(res.error).toBe('upstream_503');
    expect(res.completeness).toBe('incomplete');
  });

  it('rejects invalid payload / bad whereExtra / invalid json', async () => {
    const bad = await client(
      (async () => jsonResponse(200, { result: { nope: true } })) as unknown as typeof fetch,
    ).query({ source: 'function_edge_logs', ...WIN });
    expect(bad.error).toBe('invalid_payload');

    await expect(
      client((async () => jsonResponse(200, { result: [] })) as unknown as typeof fetch).query({
        source: 'postgres_logs',
        ...WIN,
        whereExtra: '1=1; drop table',
      }),
    ).rejects.toThrow(/whereExtra/);

    const invalidJson = await client(
      (async () =>
        new Response('not-json{', { status: 200, headers: { 'content-type': 'application/json' } })) as unknown as typeof fetch,
    ).query({ source: 'function_edge_logs', ...WIN });
    expect(invalidJson.error).toBe('invalid_json');
    expect(invalidJson.completeness).toBe('incomplete');
  });

  it('redacts secrets from API error field without echoing body secrets', async () => {
    const res = await client(
      (async () =>
        jsonResponse(200, {
          error: 'Authorization Bearer supersecretbodytoken',
        })) as unknown as typeof fetch,
    ).query({ source: 'function_edge_logs', ...WIN });
    expect(res.ok).toBe(false);
    expect(JSON.stringify(res)).not.toContain('supersecretbodytoken');
  });

  it('maps abort/timeout without leaking token', async () => {
    const fetchImpl = vi.fn(async () => {
      const err = new Error('The operation was aborted');
      err.name = 'AbortError';
      throw err;
    });
    const res = await client(fetchImpl as unknown as typeof fetch, {
      maxRetries: 0,
      timeoutMs: 1,
      accessToken: 'super-secret-token-xyz',
    }).query({ source: 'function_edge_logs', ...WIN });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/timeout|abort/i);
    expect(res.completeness).toBe('incomplete');
    expect(JSON.stringify(res)).not.toContain('super-secret-token-xyz');
  });

  it('sanitizes transport exception text', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('boom Bearer exceptionsecrettoken99');
    });
    const res = await client(fetchImpl as unknown as typeof fetch, { maxRetries: 0 }).query({
      source: 'function_edge_logs',
      ...WIN,
    });
    expect(res.ok).toBe(false);
    expect(JSON.stringify(res)).not.toContain('exceptionsecrettoken99');
  });

  it('computeQueryWindow adds overlap', () => {
    const w = computeQueryWindow({ nowMs: 1_000_000, windowMs: 60_000, overlapMs: 10_000 });
    expect(Date.parse(w.end) - Date.parse(w.start)).toBe(70_000);
  });
});
