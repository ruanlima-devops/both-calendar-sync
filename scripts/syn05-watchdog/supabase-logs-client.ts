/**
 * Read-only Supabase Management API logs client.
 * Default: no network until fetchImpl provided / explicitly called.
 * Host allowlist + STAGE project_ref only.
 * C3-A.0.1: sanitize event_message, ≤24h window assert, incompleteness typed.
 */

import { MANAGEMENT_API_HOST, STAGE_PROJECT_REF, type LogSource } from './types.ts';
import { redactText, safeErrorMessage, sanitizeLogEventMessage } from './redact.ts';

export type LogsQueryInput = {
  source: LogSource;
  iso_timestamp_start: string;
  iso_timestamp_end: string;
  /** Extra ClickHouse WHERE fragment without leading AND — validated lightly */
  whereExtra?: string;
  limit?: number;
};

/** complete = full page under limit; incomplete = truncated, transport failure, or unsafe parse */
export type LogsCompleteness = 'complete' | 'incomplete';

export type LogsQueryResult = {
  ok: boolean;
  truncated: boolean;
  completeness: LogsCompleteness;
  rows: Array<{ timestamp?: string; event_message?: string; source?: string }>;
  error?: string;
  status?: number;
  attempts: number;
};

export type SupabaseLogsClientOptions = {
  projectRef?: string;
  accessToken: string;
  fetchImpl?: typeof fetch;
  maxRetries?: number;
  baseBackoffMs?: number;
  timeoutMs?: number;
  /** Injected clock for tests */
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
};

const ALLOWED_HOST = MANAGEMENT_API_HOST;
const MAX_LIMIT = 500;
/** Official Management Logs API max range. */
export const MAX_LOG_QUERY_WINDOW_MS = 24 * 60 * 60 * 1000;
/** Allow small clock skew on end timestamp (no network NTP). */
export const FUTURE_END_TOLERANCE_MS = 5 * 60 * 1000;

function assertStageRef(ref: string): void {
  if (ref !== STAGE_PROJECT_REF) {
    throw new Error(`project_ref_not_allowlisted:${redactText(ref, 40)}`);
  }
}

function assertHttpsApiUrl(url: URL): void {
  if (url.protocol !== 'https:') throw new Error('logs_client_https_required');
  if (url.hostname !== ALLOWED_HOST) throw new Error('logs_client_host_not_allowlisted');
}

/**
 * Fail-closed time window validation BEFORE any HTTP transport.
 * Throws generic codes — never echoes raw input beyond redacted length in message.
 */
export function assertValidLogQueryWindow(
  startIso: string | undefined,
  endIso: string | undefined,
  nowMs: number,
): void {
  if (startIso == null || endIso == null || startIso === '' || endIso === '') {
    throw new Error('time_window_required');
  }
  const start = Date.parse(startIso);
  const end = Date.parse(endIso);
  if (!Number.isFinite(start) || !Number.isFinite(end)) {
    throw new Error('time_window_invalid');
  }
  if (start >= end) {
    throw new Error('time_window_order');
  }
  const duration = end - start;
  if (duration <= 0) {
    throw new Error('time_window_order');
  }
  if (duration > MAX_LOG_QUERY_WINDOW_MS) {
    throw new Error('time_window_exceeds_24h');
  }
  if (end > nowMs + FUTURE_END_TOLERANCE_MS) {
    throw new Error('time_window_end_in_future');
  }
}

function buildSql(input: LogsQueryInput): string {
  const limit = Math.min(Math.max(input.limit ?? 200, 1), MAX_LIMIT);
  const extra = input.whereExtra?.trim() ?? '';
  if (extra && !/^[a-zA-Z0-9_ .'%=<>()|-]+$/.test(extra)) {
    throw new Error('whereExtra_rejected');
  }
  // Logs API: unified `logs` stream filtered by source (ClickHouse).
  // Pagination: NOT documented as cursor-based → single page + truncated/incomplete if hit limit.
  const where = extra ? ` and (${extra})` : '';
  return `select timestamp, event_message, source from logs where source = '${input.source}'${where} order by timestamp desc limit ${limit}`;
}

function failResult(
  partial: Omit<LogsQueryResult, 'ok' | 'truncated' | 'completeness' | 'rows'> & {
    error: string;
  },
): LogsQueryResult {
  return {
    ok: false,
    truncated: false,
    completeness: 'incomplete',
    rows: [],
    error: redactText(partial.error, 160),
    status: partial.status,
    attempts: partial.attempts,
  };
}

export class SupabaseLogsClient {
  private readonly projectRef: string;
  private readonly token: string;
  private readonly fetchImpl: typeof fetch;
  private readonly maxRetries: number;
  private readonly baseBackoffMs: number;
  private readonly timeoutMs: number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly now: () => number;

  constructor(opts: SupabaseLogsClientOptions) {
    this.projectRef = opts.projectRef ?? STAGE_PROJECT_REF;
    assertStageRef(this.projectRef);
    if (!opts.accessToken || opts.accessToken.length < 8) {
      throw new Error('access_token_missing');
    }
    this.token = opts.accessToken;
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.maxRetries = opts.maxRetries ?? 3;
    this.baseBackoffMs = opts.baseBackoffMs ?? 500;
    this.timeoutMs = opts.timeoutMs ?? 30_000;
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.now = opts.now ?? (() => Date.now());
  }

  async query(input: LogsQueryInput): Promise<LogsQueryResult> {
    assertStageRef(this.projectRef);
    // Window must be valid before any HTTP attempt.
    assertValidLogQueryWindow(input.iso_timestamp_start, input.iso_timestamp_end, this.now());

    const sql = buildSql(input);
    const qs = new URLSearchParams({
      iso_timestamp_start: input.iso_timestamp_start,
      iso_timestamp_end: input.iso_timestamp_end,
      sql,
    });
    const url = new URL(
      `https://${ALLOWED_HOST}/v1/projects/${this.projectRef}/analytics/endpoints/logs?${qs}`,
    );
    assertHttpsApiUrl(url);

    let attempts = 0;
    let lastStatus: number | undefined;
    let lastErr: string | undefined;

    while (attempts <= this.maxRetries) {
      attempts += 1;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);
      try {
        const res = await this.fetchImpl(url.toString(), {
          method: 'GET',
          redirect: 'error',
          signal: controller.signal,
          headers: {
            Authorization: `Bearer ${this.token}`,
            Accept: 'application/json',
          },
        });
        lastStatus = res.status;

        if (res.status === 429) {
          const retryAfter = Number(res.headers.get('retry-after') || '');
          const backoff =
            (Number.isFinite(retryAfter) && retryAfter > 0
              ? retryAfter * 1000
              : this.baseBackoffMs * 2 ** (attempts - 1)) +
            Math.floor(Math.random() * 100);
          if (attempts > this.maxRetries) {
            return failResult({ error: 'rate_limited', status: 429, attempts });
          }
          await this.sleep(Math.min(backoff, 15_000));
          continue;
        }

        if (res.status === 401 || res.status === 403) {
          return failResult({ error: 'unauthorized', status: res.status, attempts });
        }

        if (res.status === 404) {
          return failResult({ error: 'not_found', status: 404, attempts });
        }

        if (res.status === 410) {
          // Legacy logs.all gone — no fallback host/path.
          return failResult({ error: 'endpoint_gone', status: 410, attempts });
        }

        if (res.status >= 500) {
          lastErr = `upstream_${res.status}`;
          if (attempts > this.maxRetries) {
            return failResult({ error: lastErr, status: res.status, attempts });
          }
          await this.sleep(this.baseBackoffMs * 2 ** (attempts - 1));
          continue;
        }

        if (!res.ok) {
          return failResult({ error: `http_${res.status}`, status: res.status, attempts });
        }

        let json: { result?: unknown; error?: unknown };
        try {
          json = (await res.json()) as { result?: unknown; error?: unknown };
        } catch {
          return failResult({ error: 'invalid_json', status: res.status, attempts });
        }

        if (json.error) {
          // Never echo raw API error body beyond redacted short form.
          return failResult({
            error: redactText(String(json.error), 120),
            status: res.status,
            attempts,
          });
        }
        if (!Array.isArray(json.result)) {
          return failResult({ error: 'invalid_payload', status: res.status, attempts });
        }

        const limit = Math.min(input.limit ?? 200, MAX_LIMIT);
        const seen = new Set<string>();
        const rows: LogsQueryResult['rows'] = [];
        for (const item of json.result) {
          if (!item || typeof item !== 'object') continue;
          const rec = item as Record<string, unknown>;
          const timestamp = typeof rec.timestamp === 'string' ? rec.timestamp : undefined;
          const rawMessage =
            typeof rec.event_message === 'string' ? rec.event_message : undefined;
          const event_message =
            rawMessage !== undefined ? sanitizeLogEventMessage(rawMessage) : undefined;
          const source = typeof rec.source === 'string' ? rec.source : undefined;
          const key = `${timestamp}|${event_message ?? ''}`;
          if (seen.has(key)) continue;
          seen.add(key);
          rows.push({ timestamp, event_message, source });
        }

        const truncated = rows.length >= limit;
        return {
          ok: true,
          truncated,
          completeness: truncated ? 'incomplete' : 'complete',
          rows,
          status: res.status,
          attempts,
        };
      } catch (err) {
        // Window validation throws before fetch — rethrow (no HTTP touched).
        if (err instanceof Error && err.message.startsWith('time_window_')) {
          throw err;
        }
        if (err instanceof Error && err.message === 'whereExtra_rejected') {
          throw err;
        }
        lastErr = safeErrorMessage(err);
        if (attempts > this.maxRetries) {
          return failResult({
            error: lastErr.includes('abort') ? 'timeout' : lastErr,
            status: lastStatus,
            attempts,
          });
        }
        await this.sleep(this.baseBackoffMs * 2 ** (attempts - 1));
      } finally {
        clearTimeout(timer);
      }
    }

    return failResult({
      error: lastErr ?? 'exhausted',
      status: lastStatus,
      attempts,
    });
  }
}

/** Overlapping windows: [now-window-overlap, now] — default policy 15m + 2m overlap at call site */
export function computeQueryWindow(opts: {
  nowMs: number;
  windowMs: number;
  overlapMs: number;
}): { start: string; end: string } {
  const end = opts.nowMs;
  const start = end - opts.windowMs - opts.overlapMs;
  return {
    start: new Date(start).toISOString(),
    end: new Date(end).toISOString(),
  };
}
