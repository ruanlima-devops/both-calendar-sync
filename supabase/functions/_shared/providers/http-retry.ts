import { logSafe } from '../http.ts';

/** Centralized retry/timeout policy for Google Calendar + Microsoft Graph calendar calls. */
export const PROVIDER_RETRY_POLICY = {
  /** Total attempts including the first request (bounded for Edge Function latency). */
  maxAttempts: 4,
  baseDelayMs: 250,
  maxDelayMs: 8_000,
  /** Cap for Retry-After waits so one call cannot stall the Edge Function. */
  maxRetryAfterMs: 15_000,
  /** Per-attempt HTTP timeout. */
  timeoutMs: 20_000,
} as const;

export type ProviderHttpProvider = 'GOOGLE' | 'MICROSOFT';

export type ProviderOperation =
  | 'list_calendars'
  | 'list_events'
  | 'create_event'
  | 'update_event'
  | 'delete_event'
  | 'watch_create'
  | 'watch_stop'
  | 'subscription_create'
  | 'subscription_renew'
  | 'subscription_delete'
  | 'other';

/**
 * How safely a lost response can be retried.
 * - read: GET/list — always safe
 * - idempotent_write: PATCH/PUT/DELETE by resource id — safe
 * - create: POST event — only rate-limit retries unless caller supplies idempotency
 * - subscription_create: watch/subscription POST — only rate-limit retries
 */
export type RetrySafety = 'read' | 'idempotent_write' | 'create' | 'subscription_create';

export type ProviderErrorCode =
  | 'RATE_LIMITED'
  | 'PROVIDER_UNAVAILABLE'
  | 'NETWORK_ERROR'
  | 'TIMEOUT'
  | 'AUTH_REQUIRED'
  | 'PERMISSION_ERROR'
  | 'PROVIDER_ERROR';

export class ProviderHttpError extends Error {
  readonly httpStatus?: number;
  readonly code: ProviderErrorCode;
  readonly retryExhausted: boolean;
  readonly body?: unknown;

  constructor(input: {
    message: string;
    httpStatus?: number;
    code: ProviderErrorCode;
    retryExhausted?: boolean;
    body?: unknown;
  }) {
    super(input.message);
    this.name = 'ProviderHttpError';
    this.httpStatus = input.httpStatus;
    this.code = input.code;
    this.retryExhausted = input.retryExhausted ?? false;
    this.body = input.body;
  }
}

export type ProviderFetchDeps = {
  fetch: typeof fetch;
  sleep: (ms: number) => Promise<void>;
  random: () => number;
  now: () => number;
};

const defaultDeps: ProviderFetchDeps = {
  fetch: globalThis.fetch.bind(globalThis),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  random: () => Math.random(),
  now: () => Date.now(),
};

export function parseRetryAfterHeader(
  header: string | null | undefined,
  maxMs = PROVIDER_RETRY_POLICY.maxRetryAfterMs,
  now = Date.now(),
): number | null {
  if (header == null) return null;
  const trimmed = header.trim();
  if (!trimmed) return null;

  if (/^-?\d+(\.\d+)?$/.test(trimmed)) {
    const seconds = Number(trimmed);
    if (!Number.isFinite(seconds) || seconds < 0) return null;
    return Math.min(Math.floor(seconds * 1000), maxMs);
  }

  const when = Date.parse(trimmed);
  if (Number.isNaN(when)) return null;
  const delta = when - now;
  if (delta <= 0) return 0;
  return Math.min(delta, maxMs);
}

export function computeBackoffMs(
  attemptIndex: number,
  policy: typeof PROVIDER_RETRY_POLICY = PROVIDER_RETRY_POLICY,
  random: () => number = Math.random,
): number {
  const exp = Math.min(policy.maxDelayMs, policy.baseDelayMs * 2 ** attemptIndex);
  const jitter = Math.floor(random() * policy.baseDelayMs);
  return Math.min(policy.maxDelayMs, exp + jitter);
}

export function isGoogleQuotaLimit(status: number, body: unknown): boolean {
  if (status !== 403) return false;
  const err = (body as { error?: { errors?: Array<{ reason?: string; domain?: string }>; message?: string; status?: string } })
    ?.error;
  const reasons = (err?.errors ?? []).map((e) => String(e.reason ?? ''));
  if (reasons.some((r) => ['rateLimitExceeded', 'userRateLimitExceeded', 'quotaExceeded'].includes(r))) {
    return true;
  }
  const domains = (err?.errors ?? []).map((e) => String(e.domain ?? ''));
  if (domains.some((d) => d === 'usageLimits')) return true;
  const message = `${err?.message ?? ''} ${err?.status ?? ''}`;
  return /rateLimitExceeded|userRateLimitExceeded|quotaExceeded|usageLimits/i.test(message);
}

function classifyHttpFailure(
  provider: ProviderHttpProvider,
  status: number,
  body: unknown,
): { retryable: boolean; code: ProviderErrorCode; reason: string } {
  if (status === 429) {
    return { retryable: true, code: 'RATE_LIMITED', reason: 'http_429' };
  }
  if (provider === 'GOOGLE' && isGoogleQuotaLimit(status, body)) {
    return { retryable: true, code: 'RATE_LIMITED', reason: 'google_quota_403' };
  }
  if (status === 401) {
    return { retryable: false, code: 'AUTH_REQUIRED', reason: 'http_401' };
  }
  if (status === 403) {
    return { retryable: false, code: 'PERMISSION_ERROR', reason: 'http_403_permission' };
  }
  if (status === 400) {
    return { retryable: false, code: 'PROVIDER_ERROR', reason: 'http_400' };
  }
  if (status === 502 || status === 503 || status === 504 || status === 500) {
    return { retryable: true, code: 'PROVIDER_UNAVAILABLE', reason: `http_${status}` };
  }
  return { retryable: false, code: 'PROVIDER_ERROR', reason: `http_${status}` };
}

function allowsTransientRetry(safety: RetrySafety): boolean {
  return safety === 'read' || safety === 'idempotent_write';
}

function allowsRateLimitRetry(safety: RetrySafety): boolean {
  // Rate limit responses typically mean the request was not accepted/processed.
  return true;
}

function isRetryAllowed(safety: RetrySafety, code: ProviderErrorCode): boolean {
  if (code === 'RATE_LIMITED') return allowsRateLimitRetry(safety);
  if (code === 'PROVIDER_UNAVAILABLE' || code === 'NETWORK_ERROR' || code === 'TIMEOUT') {
    return allowsTransientRetry(safety);
  }
  return false;
}

function messageFromBody(body: unknown, fallback: string): string {
  const err = (body as { error?: { message?: string } | { message?: { value?: string } } })?.error;
  if (!err) return fallback;
  if (typeof err.message === 'string') return err.message;
  if (err.message && typeof err.message === 'object' && typeof (err.message as { value?: string }).value === 'string') {
    return (err.message as { value: string }).value;
  }
  return fallback;
}

export type ProviderFetchInput = {
  provider: ProviderHttpProvider;
  operation: ProviderOperation;
  safety: RetrySafety;
  url: string;
  init?: RequestInit;
  /** When true, 204 / empty bodies are OK; 404/410 treated as success for DELETE semantics. */
  allowEmpty?: boolean;
  /** Treat 404/410 as successful empty result (idempotent delete). */
  notFoundOk?: boolean;
  policy?: typeof PROVIDER_RETRY_POLICY;
  deps?: Partial<ProviderFetchDeps>;
};

export async function providerFetch(input: ProviderFetchInput): Promise<{
  status: number;
  headers: Headers;
  body: Record<string, unknown>;
}> {
  const policy = input.policy ?? PROVIDER_RETRY_POLICY;
  const deps: ProviderFetchDeps = { ...defaultDeps, ...input.deps };
  let lastError: ProviderHttpError | undefined;

  for (let attempt = 1; attempt <= policy.maxAttempts; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), policy.timeoutMs);
    try {
      const res = await deps.fetch(input.url, {
        ...input.init,
        signal: controller.signal,
        headers: {
          ...(input.init?.headers ?? {}),
        },
      });

      if (input.notFoundOk && (res.status === 404 || res.status === 410)) {
        return { status: res.status, headers: res.headers, body: {} };
      }

      if (input.allowEmpty && (res.status === 204 || res.status === 404 || res.status === 410)) {
        if (res.ok || res.status === 404 || res.status === 410) {
          return { status: res.status, headers: res.headers, body: {} };
        }
      }

      if (res.status === 204) {
        return { status: 204, headers: res.headers, body: {} };
      }

      const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (res.ok) {
        return { status: res.status, headers: res.headers, body };
      }

      const classified = classifyHttpFailure(input.provider, res.status, body);
      const retryable = classified.retryable && isRetryAllowed(input.safety, classified.code);
      const err = new ProviderHttpError({
        message: messageFromBody(body, `${input.provider.toLowerCase()}_http_${res.status}`),
        httpStatus: res.status,
        code: classified.code,
        body,
      });

      if (!retryable || attempt >= policy.maxAttempts) {
        err.retryExhausted = retryable && attempt >= policy.maxAttempts;
        if (err.retryExhausted) {
          logSafe('provider_request_retry_exhausted', {
            provider: input.provider,
            operation: input.operation,
            attempt,
            status: res.status,
            reason: classified.reason,
            code: classified.code,
          });
        }
        throw err;
      }

      const retryAfterRaw = res.headers.get('Retry-After');
      const retryAfterMs = parseRetryAfterHeader(retryAfterRaw, policy.maxRetryAfterMs, deps.now());
      const delayMs =
        retryAfterMs != null ? retryAfterMs : computeBackoffMs(attempt - 1, policy, deps.random);

      logSafe('provider_request_retry', {
        provider: input.provider,
        operation: input.operation,
        attempt,
        maxAttempts: policy.maxAttempts,
        status: res.status,
        delay_ms: delayMs,
        reason: classified.reason,
        retry_after_present: Boolean(retryAfterRaw),
      });

      await deps.sleep(delayMs);
      lastError = err;
      continue;
    } catch (err) {
      if (err instanceof ProviderHttpError) throw err;

      const aborted =
        (err instanceof Error && err.name === 'AbortError') ||
        String(err).toLowerCase().includes('abort');
      const code: ProviderErrorCode = aborted ? 'TIMEOUT' : 'NETWORK_ERROR';
      const reason = aborted ? 'timeout' : 'network_error';
      const wrapped = new ProviderHttpError({
        message: aborted ? 'provider_timeout' : `provider_network_error:${String(err)}`,
        code,
      });

      const retryable = isRetryAllowed(input.safety, code);
      if (!retryable || attempt >= policy.maxAttempts) {
        wrapped.retryExhausted = retryable && attempt >= policy.maxAttempts;
        if (wrapped.retryExhausted) {
          logSafe('provider_request_retry_exhausted', {
            provider: input.provider,
            operation: input.operation,
            attempt,
            reason,
            code,
          });
        }
        throw wrapped;
      }

      const delayMs = computeBackoffMs(attempt - 1, policy, deps.random);
      logSafe('provider_request_retry', {
        provider: input.provider,
        operation: input.operation,
        attempt,
        maxAttempts: policy.maxAttempts,
        delay_ms: delayMs,
        reason,
        retry_after_present: false,
      });
      await deps.sleep(delayMs);
      lastError = wrapped;
    } finally {
      clearTimeout(timeout);
    }
  }

  throw (
    lastError ??
    new ProviderHttpError({
      message: 'provider_retry_exhausted',
      code: 'PROVIDER_UNAVAILABLE',
      retryExhausted: true,
    })
  );
}

/** Google Calendar insert ids must match /^[a-v0-9]{5,1024}$/. */
export function googleIdempotentEventId(seed = crypto.randomUUID()): string {
  return seed.replace(/-/g, '').toLowerCase();
}
