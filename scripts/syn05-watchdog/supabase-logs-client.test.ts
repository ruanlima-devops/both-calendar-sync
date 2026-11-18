import { afterEach, describe, expect, it, vi } from 'vitest';
import { computeQueryWindow, SupabaseLogsClient } from './supabase-logs-client.ts';
import { STAGE_PROJECT_REF } from './types.ts';

function jsonResponse(status: number, body: unknown, headers?: Record<string, string>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

describe('SupabaseLogsClient', () => {
  afterEach(() => vi.restoreAllMocks());

  it('rejects non-STAGE project_ref', () => {
    expect(
      () =>
        new SupabaseLogsClient({
          accessToken: 'token-token',
          projectRef: 'prod-not-allowed',
          fetchImpl: vi.fn() as unknown as typeof fetch,
        }),
    ).toThrow(/allowlisted/);
  });

  it('returns rows on 200 and dedupes', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(200, {
        result: [
          { timestamp: 't1', event_message: 'POST | 200 | https://x/functions/v1/reconcile-sync', source: 'function_edge_logs' },
          { timestamp: 't1', event_message: 'POST | 200 | https://x/functions/v1/reconcile-sync', source: 'function_edge_logs' },
        ],
      }),
    );
    const client = new SupabaseLogsClient({
      accessToken: 'token-token',
      fetchImpl: fetchImpl as unknown as typeof fetch,
      sleep: async () => {},
    });
    const res = await client.query({
      source: 'function_edge_logs',
      iso_timestamp_start: '2026-11-18T17:00:00Z',
      iso_timestamp_end: '2026-11-18T18:00:00Z',
      limit: 200,
    });
    expect(res.ok).toBe(true);
    expect(res.rows).toHaveLength(1);
    expect(fetchImpl).toHaveBeenCalledOnce();
    const url = String(fetchImpl.mock.calls[0]![0]);
    expect(url).toContain(STAGE_PROJECT_REF);
    expect(url).toContain('api.supabase.com');
    expect(url).not.toContain('token-token');
  });

  it('treats empty 200 as ok empty', async () => {
    const client = new SupabaseLogsClient({
      accessToken: 'token-token',
      fetchImpl: (async () => jsonResponse(200, { result: [] })) as unknown as typeof fetch,
      sleep: async () => {},
    });
    const res = await client.query({
      source: 'function_logs',
      iso_timestamp_start: '2026-11-18T17:00:00Z',
      iso_timestamp_end: '2026-11-18T18:00:00Z',
    });
    expect(res.ok).toBe(true);
    expect(res.rows).toEqual([]);
  });

  it('retries 429 with Retry-After then succeeds', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(429, { message: 'slow' }, { 'retry-after': '0' }))
      .mockResolvedValueOnce(jsonResponse(200, { result: [] }));
    const sleeps: number[] = [];
    const client = new SupabaseLogsClient({
      accessToken: 'token-token',
      fetchImpl: fetchImpl as unknown as typeof fetch,
      sleep: async (ms) => {
        sleeps.push(ms);
      },
      maxRetries: 2,
      baseBackoffMs: 10,
    });
    const res = await client.query({
      source: 'function_edge_logs',
      iso_timestamp_start: '2026-11-18T17:00:00Z',
      iso_timestamp_end: '2026-11-18T18:00:00Z',
    });
    expect(res.ok).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(sleeps.length).toBe(1);
  });

  it('exhausts 429 retries', async () => {
    const client = new SupabaseLogsClient({
      accessToken: 'token-token',
      fetchImpl: (async () => jsonResponse(429, {})) as unknown as typeof fetch,
      sleep: async () => {},
      maxRetries: 1,
      baseBackoffMs: 1,
    });
    const res = await client.query({
      source: 'function_edge_logs',
      iso_timestamp_start: '2026-11-18T17:00:00Z',
      iso_timestamp_end: '2026-11-18T18:00:00Z',
    });
    expect(res.ok).toBe(false);
    expect(res.error).toBe('rate_limited');
  });

  it('maps 401/403', async () => {
    const client = new SupabaseLogsClient({
      accessToken: 'token-token',
      fetchImpl: (async () => jsonResponse(401, {})) as unknown as typeof fetch,
      sleep: async () => {},
    });
    const res = await client.query({
      source: 'function_edge_logs',
      iso_timestamp_start: '2026-11-18T17:00:00Z',
      iso_timestamp_end: '2026-11-18T18:00:00Z',
    });
    expect(res.error).toBe('unauthorized');
  });

  it('retries 5xx then fails', async () => {
    const client = new SupabaseLogsClient({
      accessToken: 'token-token',
      fetchImpl: (async () => jsonResponse(503, {})) as unknown as typeof fetch,
      sleep: async () => {},
      maxRetries: 0,
    });
    const res = await client.query({
      source: 'function_edge_logs',
      iso_timestamp_start: '2026-11-18T17:00:00Z',
      iso_timestamp_end: '2026-11-18T18:00:00Z',
    });
    expect(res.ok).toBe(false);
    expect(res.error).toBe('upstream_503');
  });

  it('flags truncated when rows hit limit', async () => {
    const rows = Array.from({ length: 3 }, (_, i) => ({
      timestamp: `t${i}`,
      event_message: `m${i}`,
      source: 'function_edge_logs',
    }));
    const client = new SupabaseLogsClient({
      accessToken: 'token-token',
      fetchImpl: (async () => jsonResponse(200, { result: rows })) as unknown as typeof fetch,
      sleep: async () => {},
    });
    const res = await client.query({
      source: 'function_edge_logs',
      iso_timestamp_start: '2026-11-18T17:00:00Z',
      iso_timestamp_end: '2026-11-18T18:00:00Z',
      limit: 3,
    });
    expect(res.truncated).toBe(true);
  });

  it('rejects invalid payload and bad whereExtra', async () => {
    const client = new SupabaseLogsClient({
      accessToken: 'token-token',
      fetchImpl: (async () => jsonResponse(200, { result: { nope: true } })) as unknown as typeof fetch,
      sleep: async () => {},
    });
    const bad = await client.query({
      source: 'function_edge_logs',
      iso_timestamp_start: '2026-11-18T17:00:00Z',
      iso_timestamp_end: '2026-11-18T18:00:00Z',
    });
    expect(bad.error).toBe('invalid_payload');

    await expect(
      client.query({
        source: 'postgres_logs',
        iso_timestamp_start: '2026-11-18T17:00:00Z',
        iso_timestamp_end: '2026-11-18T18:00:00Z',
        whereExtra: '1=1; drop table',
      }),
    ).rejects.toThrow(/whereExtra/);
  });

  it('computeQueryWindow adds overlap', () => {
    const w = computeQueryWindow({ nowMs: 1_000_000, windowMs: 60_000, overlapMs: 10_000 });
    expect(Date.parse(w.end) - Date.parse(w.start)).toBe(70_000);
  });

  it('maps abort/timeout without leaking token', async () => {
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      const err = new Error('The operation was aborted');
      err.name = 'AbortError';
      if (init?.signal?.aborted) throw err;
      throw err;
    });
    const client = new SupabaseLogsClient({
      accessToken: 'super-secret-token-xyz',
      fetchImpl: fetchImpl as unknown as typeof fetch,
      sleep: async () => {},
      maxRetries: 0,
      timeoutMs: 1,
    });
    const res = await client.query({
      source: 'function_edge_logs',
      iso_timestamp_start: '2026-11-18T17:00:00Z',
      iso_timestamp_end: '2026-11-18T18:00:00Z',
    });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/timeout|abort/i);
    expect(JSON.stringify(res)).not.toContain('super-secret-token-xyz');
  });
});
