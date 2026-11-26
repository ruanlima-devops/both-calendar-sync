import {
  parseFunctionEdgeMessage,
  type EdgeInvocation,
} from '../../supabase/functions/_shared/observability/alert-evaluator.ts';
import type { NormalizedSignal } from './types.ts';

export function normalizeEdgeRows(
  rows: Array<{ timestamp?: string; event_message?: string }>,
): NormalizedSignal[] {
  const out: NormalizedSignal[] = [];
  for (const row of rows) {
    if (!row.timestamp || !row.event_message) continue;
    const inv: EdgeInvocation = { timestamp: row.timestamp, event_message: row.event_message };
    const p = parseFunctionEdgeMessage(inv);
    if (p.status == null || !p.functionName) continue;
    out.push({
      kind: 'edge_http',
      timestamp: p.timestamp,
      method: p.method,
      status: p.status,
      functionName: p.functionName,
      path: p.path,
    });
  }
  return out;
}

export function normalizeConsoleRows(
  rows: Array<{ timestamp?: string; event_message?: string }>,
): NormalizedSignal[] {
  const out: NormalizedSignal[] = [];
  for (const row of rows) {
    if (!row.timestamp || !row.event_message) continue;
    const msg = row.event_message.trim();
    if (!msg.startsWith('{')) continue;
    try {
      const obj = JSON.parse(msg) as Record<string, unknown>;
      const event_name = String(obj.event_name ?? obj.message ?? 'unknown');
      out.push({
        kind: 'console_event',
        timestamp: typeof obj.timestamp === 'string' ? obj.timestamp : row.timestamp,
        event_name,
        message: typeof obj.message === 'string' ? obj.message : undefined,
        outcome: typeof obj.outcome === 'string' ? obj.outcome : undefined,
        provider: typeof obj.provider === 'string' ? obj.provider : undefined,
        raw_keys: Object.keys(obj).slice(0, 30),
      });
    } catch {
      // ignore non-JSON console lines
    }
  }
  return out;
}

export function normalizePostgresCronRows(
  rows: Array<{ timestamp?: string; event_message?: string }>,
): NormalizedSignal[] {
  const out: NormalizedSignal[] = [];
  for (const row of rows) {
    if (!row.timestamp || !row.event_message) continue;
    const m = row.event_message.match(/both_invoke_cron_function\('([^']+)'\)/);
    if (!m) continue;
    out.push({
      kind: 'pg_cron_start',
      timestamp: row.timestamp,
      jobHint: m[1]!,
    });
  }
  return out;
}

export function edgeInvocationsFromSignals(
  signals: NormalizedSignal[],
): EdgeInvocation[] {
  return signals
    .filter((s): s is Extract<NormalizedSignal, { kind: 'edge_http' }> => s.kind === 'edge_http')
    .map((s) => ({
      timestamp: s.timestamp,
      event_message: `${s.method ?? 'POST'} | ${s.status} | https://qszggrrjhcwltnmxpxcy.supabase.co/functions/v1/${s.functionName}`,
    }));
}
