/**
 * OF-01 external observer foundation — offline negatives. No live network.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_EXTERNAL_OBSERVER_CONFIG,
  EXTERNAL_OBSERVER_ARCHITECTURE,
  createInMemoryStatusSource,
  evaluateExternalObserver,
  validateExternalObserverConfig,
  type ExternalObserverConfig,
  type HeartbeatSample,
} from './external-observer-foundation.ts';
import { STAGE_ENVIRONMENT, STAGE_PROJECT_REF } from './types.ts';

const NOW = Date.parse('2026-11-22T15:00:00.000Z');
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');

function enabledConfig(over: Partial<ExternalObserverConfig> = {}): ExternalObserverConfig {
  return {
    ...DEFAULT_EXTERNAL_OBSERVER_CONFIG,
    enabled: true,
    authorization_gate: 'PO_AUTHORIZED',
    ...over,
  };
}

function hb(over: Partial<HeartbeatSample> = {}): HeartbeatSample {
  return {
    id: 'hb-1',
    observed_at: new Date(NOW - 2 * 60_000).toISOString(),
    status: 'ok',
    environment: STAGE_ENVIRONMENT,
    project_ref: STAGE_PROJECT_REF,
    ...over,
  };
}

describe('OF-01 config / gate', () => {
  it('default config is disabled / gate OFF', () => {
    expect(DEFAULT_EXTERNAL_OBSERVER_CONFIG.enabled).toBe(false);
    expect(DEFAULT_EXTERNAL_OBSERVER_CONFIG.authorization_gate).toBe('OFF');
  });

  it('rejects invalid config schema', () => {
    expect(validateExternalObserverConfig({}).ok).toBe(false);
  });

  it('gate OFF → DISABLED_INTENTIONALLY even if enabled flag true without gate', async () => {
    const r = await evaluateExternalObserver({
      config: { ...DEFAULT_EXTERNAL_OBSERVER_CONFIG, enabled: true },
      nowMs: NOW,
      statusSource: createInMemoryStatusSource(hb()),
    });
    expect(r.health).toBe('DISABLED_INTENTIONALLY');
    expect(r.operationally_active).toBe(false);
    expect(r.http_performed).toBe(false);
  });
});

describe('OF-01 clock / status source', () => {
  it('missing clock → UNKNOWN', async () => {
    const r = await evaluateExternalObserver({
      config: enabledConfig(),
      statusSource: createInMemoryStatusSource(hb()),
      nowMs: null,
    });
    expect(r.health).toBe('UNKNOWN');
    expect(r.reason_code).toBe('clock_missing');
  });

  it('missing status source → OBSERVER_BLIND', async () => {
    const r = await evaluateExternalObserver({
      config: enabledConfig(),
      nowMs: NOW,
      statusSource: null,
    });
    expect(r.health).toBe('OBSERVER_BLIND');
    expect(r.reason_code).toBe('status_source_missing');
  });

  it('status source unavailable → OBSERVER_BLIND', async () => {
    const src = createInMemoryStatusSource();
    src.setError('source_unavailable');
    const r = await evaluateExternalObserver({
      config: enabledConfig(),
      nowMs: NOW,
      statusSource: src,
    });
    expect(r.health).toBe('OBSERVER_BLIND');
    expect(r.reason_code).toBe('source_unavailable');
  });

  it('absent heartbeat → EXPECTED_BUT_MISSING', async () => {
    const r = await evaluateExternalObserver({
      config: enabledConfig(),
      nowMs: NOW,
      statusSource: createInMemoryStatusSource(null),
    });
    expect(r.health).toBe('EXPECTED_BUT_MISSING');
  });
});

describe('OF-01 heartbeat evaluation', () => {
  it('healthy within window', async () => {
    const r = await evaluateExternalObserver({
      config: enabledConfig(),
      nowMs: NOW,
      statusSource: createInMemoryStatusSource(hb()),
    });
    expect(r.health).toBe('HEALTHY');
    expect(r.operationally_active).toBe(false);
  });

  it('expired heartbeat → EXPECTED_BUT_MISSING', async () => {
    const r = await evaluateExternalObserver({
      config: enabledConfig(),
      nowMs: NOW,
      statusSource: createInMemoryStatusSource(
        hb({ observed_at: new Date(NOW - 40 * 60_000).toISOString() }),
      ),
    });
    expect(r.health).toBe('EXPECTED_BUT_MISSING');
    expect(r.reason_code).toBe('heartbeat_expired');
  });

  it('fail status → FAILED', async () => {
    const r = await evaluateExternalObserver({
      config: enabledConfig(),
      nowMs: NOW,
      statusSource: createInMemoryStatusSource(hb({ status: 'fail' })),
    });
    expect(r.health).toBe('FAILED');
  });

  it('future timestamp → UNKNOWN', async () => {
    const r = await evaluateExternalObserver({
      config: enabledConfig(),
      nowMs: NOW,
      statusSource: createInMemoryStatusSource(
        hb({ observed_at: new Date(NOW + 10 * 60_000).toISOString() }),
      ),
    });
    expect(r.health).toBe('UNKNOWN');
    expect(r.reason_code).toBe('future_timestamp');
  });

  it('cross-environment confusion', async () => {
    const r = await evaluateExternalObserver({
      config: enabledConfig(),
      nowMs: NOW,
      statusSource: createInMemoryStatusSource(
        hb({ environment: 'prod' as typeof STAGE_ENVIRONMENT }),
      ),
    });
    expect(r.health).toBe('UNKNOWN');
    expect(r.reason_code).toBe('cross_environment_confusion');
  });

  it('falsified heartbeat project → UNKNOWN', async () => {
    const r = await evaluateExternalObserver({
      config: enabledConfig(),
      nowMs: NOW,
      statusSource: createInMemoryStatusSource(
        hb({ project_ref: 'sknpqjodttkpttaytdut' as typeof STAGE_PROJECT_REF }),
      ),
    });
    expect(r.reason_code).toBe('cross_project_confusion');
  });
});

describe('OF-01 architecture / no side effects', () => {
  it('does not treat GitHub Actions as external independence', () => {
    expect(EXTERNAL_OBSERVER_ARCHITECTURE.github_actions_as_external).toBe(
      'insufficient_shared_failure_domain',
    );
    expect(EXTERNAL_OBSERVER_ARCHITECTURE.provisioned).toBe(false);
  });

  it('module source has no auto-fetch / no schedule trigger', () => {
    const src = readFileSync(path.join(HERE, 'external-observer-foundation.ts'), 'utf8');
    expect(src).not.toMatch(/\bfetch\s*\(/);
    expect(src).not.toMatch(/cron:/);
    expect(src).not.toMatch(/workflow_dispatch/);
  });

  it('SEC-07 tombstone still present on tip', () => {
    const entry = readFileSync(
      path.join(ROOT, 'supabase/functions/sync-calendar/index.ts'),
      'utf8',
    );
    expect(entry).toContain('handleLegacySyncCalendar');
    expect(entry).not.toContain('processSyncJob');
  });
});
