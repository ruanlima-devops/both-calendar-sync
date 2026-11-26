/**
 * OF-02 alert channel — offline negatives. No real delivery.
 */

import { describe, expect, it } from 'vitest';
import {
  ALERT_CHANNEL_ARCHITECTURE,
  ALERT_SCHEMA_VERSION,
  DEFAULT_ALERT_CHANNEL_CONFIG,
  createDisabledAlertSink,
  createInMemoryAlertSink,
  resolveAlertSink,
  sanitizeAlertNotification,
  validateAlertNotification,
  type AlertNotificationV1,
} from './alert-channel.ts';
import { STAGE_ENVIRONMENT } from './types.ts';

const NOW = Date.parse('2026-11-22T15:00:00.000Z');

function base(over: Partial<AlertNotificationV1> = {}): AlertNotificationV1 {
  return {
    schema_version: ALERT_SCHEMA_VERSION,
    event_id: 'evt-00000001',
    source: 'external_observer',
    environment: STAGE_ENVIRONMENT,
    severity: 'P1',
    classification: 'EXPECTED_BUT_MISSING',
    reason_code: 'heartbeat_expired',
    observed_at: new Date(NOW).toISOString(),
    first_detected_at: new Date(NOW - 60_000).toISOString(),
    dedup_key: 'observer|heartbeat_expired|stage',
    action_required: 'investigate_watchdog_schedule',
    status: 'firing',
    ...over,
  };
}

describe('OF-02 payload safety', () => {
  it('accepts minimal safe payload', () => {
    expect(validateAlertNotification(base()).ok).toBe(true);
  });

  it('rejects PII email', () => {
    const r = validateAlertNotification(base({ action_required: 'ping user@example.com' }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toMatch(/pii|forbidden/);
  });

  it('rejects token-like content', () => {
    const r = validateAlertNotification(base({ reason_code: 'bearer ghp_abcdefghijklmnopqrstuv' }));
    expect(r.ok).toBe(false);
  });

  it('rejects SQL-ish content', () => {
    const r = validateAlertNotification(base({ action_required: 'SELECT * FROM users' }));
    expect(r.ok).toBe(false);
  });

  it('rejects additional properties', () => {
    const r = validateAlertNotification({ ...base(), secret: 'x' } as unknown);
    expect(r.ok).toBe(false);
  });

  it('sanitize redacts reason/action', () => {
    const s = sanitizeAlertNotification(
      base({ reason_code: 'token=abc123secretvalue', action_required: 'check' }),
    );
    expect(s.reason_code).toContain('[redacted]');
  });
});

describe('OF-02 sink disabled / gates', () => {
  it('default sink is disabled', async () => {
    const sink = createDisabledAlertSink();
    expect(sink.operationally_active).toBe(false);
    const r = await sink.send(base(), NOW);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.delivered).toBe(false);
      expect(r.code).toBe('alert_channel_not_authorized');
    }
  });

  it('env presence does not enable real sink', () => {
    const sink = resolveAlertSink(DEFAULT_ALERT_CHANNEL_CONFIG, {
      BOTH_ALERT_WEBHOOK_URL: 'https://example.invalid/hook',
      ALERT_CHANNEL_TOKEN: 'secret',
    });
    expect(sink.kind).toBe('disabled');
  });

  it('fake sink still reports delivered=false', async () => {
    const sink = createInMemoryAlertSink({
      ...DEFAULT_ALERT_CHANNEL_CONFIG,
      enabled: true,
      authorization_gate: 'PO_AUTHORIZED',
      provider: 'fake',
    });
    const r = await sink.send(base(), NOW);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.delivered).toBe(false);
    expect(sink.attempts).toHaveLength(1);
  });
});

describe('OF-02 rate / dedup / cooldown / storm', () => {
  it('cooldown suppresses repeats', async () => {
    const sink = createInMemoryAlertSink({
      ...DEFAULT_ALERT_CHANNEL_CONFIG,
      enabled: true,
      authorization_gate: 'PO_AUTHORIZED',
      provider: 'fake',
      cooldown_ms: 60_000,
    });
    await sink.send(base(), NOW);
    const r2 = await sink.send(base({ event_id: 'evt-00000002' }), NOW + 1_000);
    expect(r2.ok).toBe(true);
    if (r2.ok) expect(r2.code).toBe('cooldown_suppressed');
  });

  it('rate limit suppresses', async () => {
    const sink = createInMemoryAlertSink({
      ...DEFAULT_ALERT_CHANNEL_CONFIG,
      enabled: true,
      authorization_gate: 'PO_AUTHORIZED',
      provider: 'fake',
      cooldown_ms: 0,
      rate_limit_per_window: 2,
    });
    await sink.send(base({ event_id: 'evt-00000a' }), NOW);
    await sink.send(base({ event_id: 'evt-00000b' }), NOW + 1);
    const r3 = await sink.send(base({ event_id: 'evt-00000c' }), NOW + 2);
    expect(r3.ok).toBe(true);
    if (r3.ok) expect(r3.code).toBe('rate_limited');
  });

  it('alert storm suppressed', async () => {
    const sink = createInMemoryAlertSink({
      ...DEFAULT_ALERT_CHANNEL_CONFIG,
      enabled: true,
      authorization_gate: 'PO_AUTHORIZED',
      provider: 'fake',
      cooldown_ms: 0,
      rate_limit_per_window: 100,
      storm_threshold: 3,
    });
    for (let i = 0; i < 3; i++) {
      const res = await sink.send(
        base({ event_id: `evt-storm${i}`, dedup_key: `dedup-key-${i}` }),
        NOW + i,
      );
      expect(res.ok).toBe(true);
      if (res.ok) expect(res.code).toBe('fake_sink_recorded');
    }
    const r = await sink.send(
      base({ event_id: 'evt-stormx', dedup_key: 'dedup-key-new' }),
      NOW + 10,
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.code).toBe('alert_storm_suppressed');
  });
});

describe('OF-02 architecture', () => {
  it('recommends independent webhook; not provisioned', () => {
    expect(ALERT_CHANNEL_ARCHITECTURE.recommended).toBe('independent_webhook');
    expect(ALERT_CHANNEL_ARCHITECTURE.provisioned).toBe(false);
    expect(ALERT_CHANNEL_ARCHITECTURE.operationally_active).toBe(false);
    expect(ALERT_CHANNEL_ARCHITECTURE.po_decision_pending).toBe(true);
  });
});
