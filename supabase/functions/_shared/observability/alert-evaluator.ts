/**
 * SYN-05 Gate B — deterministic alert evaluators (local only, no network).
 * Thresholds are hypotheses for calibration; callers supply evidence windows.
 */

export type EdgeInvocation = {
  timestamp: string; // ISO
  event_message: string;
};

export type ParsedEdgeLog = {
  timestamp: string;
  method?: string;
  status?: number;
  path?: string;
  functionName?: string;
};

export type AlertFinding = {
  alert_id: string;
  firing: boolean;
  severity: 'P0' | 'P1' | 'P2';
  reason: string;
  sample_count: number;
  window_start?: string;
  window_end?: string;
  dedupe_key: string;
};

const EDGE_RE = /^(OPTIONS|GET|POST|PUT|PATCH|DELETE)\s*\|\s*(\d{3})\s*\|\s*(https?:\/\/\S+)/i;

/** Parse Supabase function_edge_logs event_message lines. */
export function parseFunctionEdgeMessage(row: EdgeInvocation): ParsedEdgeLog {
  const msg = String(row.event_message ?? '');
  const m = msg.match(EDGE_RE);
  if (!m) return { timestamp: row.timestamp };
  const url = m[3]!;
  let path: string | undefined;
  let functionName: string | undefined;
  try {
    const u = new URL(url.split('?')[0]!);
    path = u.pathname;
    const parts = path.split('/').filter(Boolean);
    const idx = parts.indexOf('functions');
    if (idx >= 0 && parts[idx + 2]) functionName = parts[idx + 2];
  } catch {
    path = undefined;
  }
  return {
    timestamp: row.timestamp,
    method: m[1]!.toUpperCase(),
    status: Number(m[2]),
    path,
    functionName,
  };
}

export type Edge5xxOptions = {
  windowMs: number;
  minCount: number;
  /** Functions that must never page on expected client statuses */
  ignoreStatuses?: number[];
  functionAllowlist?: string[];
  nowMs?: number;
};

/**
 * ALERT-01: sustained Edge Function 5xx.
 * Ignores 401/403/410 by default (expected auth / SEC-07 tombstone).
 */
export function evaluateEdge5xx(
  rows: EdgeInvocation[],
  opts: Edge5xxOptions,
): AlertFinding {
  const ignore = new Set(opts.ignoreStatuses ?? [401, 403, 404, 410]);
  const now = opts.nowMs ?? Date.now();
  const start = now - opts.windowMs;
  const allow = opts.functionAllowlist ? new Set(opts.functionAllowlist) : null;
  const hits: ParsedEdgeLog[] = [];
  for (const row of rows) {
    const parsed = parseFunctionEdgeMessage(row);
    const t = Date.parse(parsed.timestamp);
    if (!Number.isFinite(t) || t < start || t > now) continue;
    if (parsed.status == null || parsed.status < 500 || parsed.status > 599) continue;
    if (ignore.has(parsed.status)) continue;
    if (allow && parsed.functionName && !allow.has(parsed.functionName)) continue;
    if (allow && !parsed.functionName) continue;
    hits.push(parsed);
  }
  const byFn = new Map<string, number>();
  for (const h of hits) {
    const k = h.functionName ?? 'unknown';
    byFn.set(k, (byFn.get(k) ?? 0) + 1);
  }
  const offenders = [...byFn.entries()].filter(([, n]) => n >= opts.minCount);
  const firing = offenders.length > 0;
  return {
    alert_id: 'ALERT-01',
    firing,
    severity: 'P1',
    reason: firing
      ? `5xx sustained: ${offenders.map(([f, n]) => `${f}=${n}`).join(', ')}`
      : `no 5xx above minCount=${opts.minCount}`,
    sample_count: hits.length,
    window_start: new Date(start).toISOString(),
    window_end: new Date(now).toISOString(),
    dedupe_key: `ALERT-01:${[...byFn.keys()].sort().join(',') || 'none'}`,
  };
}

export type CronMissOptions = {
  expectedIntervalMs: number;
  graceMs: number;
  nowMs?: number;
  jobName: string;
};

/**
 * ALERT-02: missing cron/reconcile heartbeat.
 * Uses last successful execution timestamp (e.g. function_edge_logs 200 for reconcile-sync).
 * Zero work ≠ miss; absence of invocation evidence = miss.
 */
export function evaluateCronMiss(
  lastSuccessIso: string | null | undefined,
  opts: CronMissOptions,
): AlertFinding {
  const now = opts.nowMs ?? Date.now();
  if (!lastSuccessIso) {
    return {
      alert_id: 'ALERT-02',
      firing: true,
      severity: 'P1',
      reason: `no success heartbeat for ${opts.jobName}`,
      sample_count: 0,
      window_end: new Date(now).toISOString(),
      dedupe_key: `ALERT-02:${opts.jobName}:none`,
    };
  }
  const last = Date.parse(lastSuccessIso);
  const age = now - last;
  const limit = opts.expectedIntervalMs + opts.graceMs;
  const firing = !Number.isFinite(last) || age > limit;
  return {
    alert_id: 'ALERT-02',
    firing,
    severity: 'P1',
    reason: firing
      ? `${opts.jobName} last success age_ms=${age} > limit_ms=${limit}`
      : `${opts.jobName} heartbeat fresh age_ms=${age}`,
    sample_count: 1,
    window_end: new Date(now).toISOString(),
    dedupe_key: `ALERT-02:${opts.jobName}`,
  };
}

export type BillingLogEvent = {
  timestamp: string;
  event_name?: string;
  message?: string;
  outcome?: string;
  status?: number;
};

export type BillingFailOptions = {
  windowMs: number;
  minProcessingFailures: number;
  /** invalid_signature counted separately (security noise vs processing) */
  minInvalidSignature?: number;
  nowMs?: number;
};

/**
 * ALERT-03: billing webhook processing failures.
 * Distinguishes invalid_signature (often expected/noise) from apply_failed / HTTP 500.
 */
export function evaluateBillingFailures(
  events: BillingLogEvent[],
  opts: BillingFailOptions,
): AlertFinding {
  const now = opts.nowMs ?? Date.now();
  const start = now - opts.windowMs;
  let applyFailed = 0;
  let invalidSig = 0;
  let http500 = 0;
  for (const e of events) {
    const t = Date.parse(e.timestamp);
    if (!Number.isFinite(t) || t < start || t > now) continue;
    const name = `${e.event_name ?? ''} ${e.message ?? ''}`.toLowerCase();
    if (name.includes('invalid_signature')) {
      invalidSig += 1;
      continue;
    }
    // Expected skip paths (deleted account, etc.) are not processing failures.
    if (
      name.includes('skipped_deleted_account') ||
      e.outcome === 'skipped' ||
      name.includes('skipped')
    ) {
      continue;
    }
    if (name.includes('apply_failed') || e.outcome === 'failed') {
      applyFailed += 1;
    }
    if (e.status != null && e.status >= 500) http500 += 1;
  }
  const processing = applyFailed + http500;
  const firing = processing >= opts.minProcessingFailures;
  return {
    alert_id: 'ALERT-03',
    firing,
    severity: firing ? 'P1' : 'P2',
    reason: firing
      ? `billing processing failures=${processing} (applyFailed=${applyFailed}, http500=${http500}); invalid_sig=${invalidSig}`
      : `billing processing ok; invalid_sig=${invalidSig}`,
    sample_count: processing + invalidSig,
    window_start: new Date(start).toISOString(),
    window_end: new Date(now).toISOString(),
    dedupe_key: 'ALERT-03:billing-webhook',
  };
}

/** Latest success timestamp for a function from edge rows (status 200). */
export function latestEdgeSuccess(
  rows: EdgeInvocation[],
  functionName: string,
): string | null {
  let best: string | null = null;
  let bestMs = -1;
  for (const row of rows) {
    const p = parseFunctionEdgeMessage(row);
    if (p.functionName !== functionName || p.status !== 200) continue;
    const t = Date.parse(p.timestamp);
    if (t > bestMs) {
      bestMs = t;
      best = p.timestamp;
    }
  }
  return best;
}
