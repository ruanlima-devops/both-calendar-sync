import { describe, expect, it } from 'vitest';
import {
  evaluateBillingFailures,
  evaluateCronMiss,
  evaluateEdge5xx,
  latestEdgeSuccess,
  parseFunctionEdgeMessage,
} from './alert-evaluator.ts';

const NOW = Date.parse('2026-11-18T18:00:00.000Z');

describe('SYN-05 Gate B alert-evaluator', () => {
  it('parses function_edge_logs and ignores expected 410/401', () => {
    const p = parseFunctionEdgeMessage({
      timestamp: '2026-11-18T17:00:00.000Z',
      event_message:
        'POST | 410 | https://qszggrrjhcwltnmxpxcy.supabase.co/functions/v1/sync-calendar',
    });
    expect(p.status).toBe(410);
    expect(p.functionName).toBe('sync-calendar');

    const finding = evaluateEdge5xx(
      [
        {
          timestamp: '2026-11-18T17:59:00.000Z',
          event_message:
            'POST | 410 | https://qszggrrjhcwltnmxpxcy.supabase.co/functions/v1/sync-calendar',
        },
        {
          timestamp: '2026-11-18T17:58:00.000Z',
          event_message:
            'POST | 401 | https://qszggrrjhcwltnmxpxcy.supabase.co/functions/v1/delete-account',
        },
      ],
      { windowMs: 15 * 60_000, minCount: 3, nowMs: NOW },
    );
    expect(finding.firing).toBe(false);
  });

  it('fires ALERT-01 on sustained 5xx for a critical function', () => {
    const rows = [1, 2, 3].map((i) => ({
      timestamp: new Date(NOW - i * 60_000).toISOString(),
      event_message: `POST | 500 | https://example.supabase.co/functions/v1/billing-webhook`,
    }));
    const finding = evaluateEdge5xx(rows, {
      windowMs: 15 * 60_000,
      minCount: 3,
      nowMs: NOW,
      functionAllowlist: ['billing-webhook', 'reconcile-sync', 'google-oauth'],
    });
    expect(finding.firing).toBe(true);
    expect(finding.alert_id).toBe('ALERT-01');
    expect(finding.reason).toContain('billing-webhook=3');
  });

  it('ALERT-02 detects missing reconcile heartbeat with grace', () => {
    const ok = evaluateCronMiss('2026-11-18T17:45:03.000Z', {
      jobName: 'reconcile-sync',
      expectedIntervalMs: 15 * 60_000,
      graceMs: 5 * 60_000,
      nowMs: NOW,
    });
    expect(ok.firing).toBe(false);

    const miss = evaluateCronMiss('2026-11-18T17:00:00.000Z', {
      jobName: 'reconcile-sync',
      expectedIntervalMs: 15 * 60_000,
      graceMs: 5 * 60_000,
      nowMs: NOW,
    });
    expect(miss.firing).toBe(true);
  });

  it('ALERT-03 separates invalid_signature noise from apply_failed', () => {
    const events = [
      { timestamp: '2026-11-18T17:50:00.000Z', event_name: 'billing-webhook_invalid_signature', message: '[billing-webhook] invalid_signature' },
      { timestamp: '2026-11-18T17:51:00.000Z', event_name: 'billing-webhook_invalid_signature', message: '[billing-webhook] invalid_signature' },
      { timestamp: '2026-11-18T17:52:00.000Z', event_name: 'billing-webhook_apply_failed', message: '[billing-webhook] apply_failed' },
      { timestamp: '2026-11-18T17:53:00.000Z', event_name: 'billing-webhook_apply_failed', message: '[billing-webhook] apply_failed' },
      { timestamp: '2026-11-18T17:54:00.000Z', event_name: 'billing-webhook_apply_failed', message: '[billing-webhook] apply_failed' },
    ];
    const finding = evaluateBillingFailures(events, {
      windowMs: 15 * 60_000,
      minProcessingFailures: 3,
      nowMs: NOW,
    });
    expect(finding.firing).toBe(true);
    expect(finding.reason).toContain('invalid_sig=2');
  });

  it('latestEdgeSuccess picks newest 200 for function', () => {
    const ts = latestEdgeSuccess(
      [
        {
          timestamp: '2026-11-18T17:30:00.000Z',
          event_message:
            'POST | 200 | https://qszggrrjhcwltnmxpxcy.supabase.co/functions/v1/reconcile-sync',
        },
        {
          timestamp: '2026-11-18T17:45:00.000Z',
          event_message:
            'POST | 200 | https://qszggrrjhcwltnmxpxcy.supabase.co/functions/v1/reconcile-sync',
        },
        {
          timestamp: '2026-11-18T17:50:00.000Z',
          event_message:
            'POST | 500 | https://qszggrrjhcwltnmxpxcy.supabase.co/functions/v1/reconcile-sync',
        },
      ],
      'reconcile-sync',
    );
    expect(ts).toBe('2026-11-18T17:45:00.000Z');
  });
});
