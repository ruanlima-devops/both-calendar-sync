import { describe, expect, it } from 'vitest';
import {
  applyEvaluationToState,
  parseIncidentState,
  serializeIncidentState,
  upsertIncidentStateBlock,
  type IncidentStateV1,
} from './incident-state.ts';
import { STAGE_PROJECT_REF } from './types.ts';
import type { AlertEvaluation } from './types.ts';

function ev(partial: Partial<AlertEvaluation>): AlertEvaluation {
  return {
    alert_id: 'ALERT-01',
    severity: 'P1',
    environment: 'stage',
    project_ref: STAGE_PROJECT_REF,
    evaluation_status: 'FIRING',
    observed_count: 1,
    time_window: { start: '2026-11-19T00:00:00.000Z', end: '2026-11-19T00:10:00.000Z' },
    fingerprint: 'ALERT-01|qszggrrjhcwltnmxpxcy|fp',
    evidence_summary: 'x',
    ...partial,
  };
}

describe('incident-state', () => {
  it('round-trips serialize/parse', () => {
    const state: IncidentStateV1 = {
      schema_version: 1,
      project_ref: STAGE_PROJECT_REF,
      environment: 'stage',
      alert_id: 'ALERT-01',
      fingerprint: 'fp1',
      first_seen_at: '2026-11-19T00:00:00.000Z',
      last_seen_at: '2026-11-19T01:00:00.000Z',
      consecutive_healthy: 1,
      alert_status: 'RECOVERING',
      last_transition_at: '2026-11-19T01:00:00.000Z',
    };
    const body = upsertIncidentStateBlock('human note\n', state);
    expect(body).toContain('human note');
    const parsed = parseIncidentState(body);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.state.consecutive_healthy).toBe(1);
  });

  it('fail-closed on corrupt json', () => {
    const body = `<!-- both-syn05-state:v1\nNOT_JSON\n-->`;
    const parsed = parseIncidentState(body);
    expect(parsed.ok).toBe(false);
    expect(parsed.trusted).toBe(false);
  });

  it('fail-closed on unknown schema', () => {
    const body = serializeIncidentState({
      schema_version: 1,
      project_ref: STAGE_PROJECT_REF,
      environment: 'stage',
      alert_id: 'ALERT-01',
      fingerprint: 'fp',
      first_seen_at: '2026-11-19T00:00:00.000Z',
      last_seen_at: '2026-11-19T00:00:00.000Z',
      consecutive_healthy: 9,
      alert_status: 'FIRING',
      last_transition_at: '2026-11-19T00:00:00.000Z',
    }).replace('"schema_version":1', '"schema_version":99');
    const parsed = parseIncidentState(body);
    expect(parsed.ok).toBe(false);
  });

  it('does not double-count same window HEALTHY', () => {
    const first = applyEvaluationToState(null, ev({ evaluation_status: 'HEALTHY' }), '2026-11-19T02:00:00.000Z');
    expect(first.state.consecutive_healthy).toBe(1);
    const second = applyEvaluationToState(
      first.state,
      ev({ evaluation_status: 'HEALTHY' }),
      '2026-11-19T02:01:00.000Z',
    );
    expect(second.skipDuplicateSample).toBe(true);
    expect(second.state.consecutive_healthy).toBe(1);
  });

  it('ignores out-of-order older window', () => {
    const newer = applyEvaluationToState(
      null,
      ev({
        evaluation_status: 'HEALTHY',
        time_window: { start: 't', end: '2026-11-19T03:00:00.000Z' },
      }),
      '2026-11-19T03:00:00.000Z',
    );
    const older = applyEvaluationToState(
      newer.state,
      ev({
        evaluation_status: 'HEALTHY',
        time_window: { start: 't', end: '2026-11-19T02:00:00.000Z' },
      }),
      '2026-11-19T03:05:00.000Z',
    );
    expect(older.skipDuplicateSample).toBe(true);
    expect(older.state.consecutive_healthy).toBe(newer.state.consecutive_healthy);
  });

  it('resets streak on FIRING', () => {
    let s = applyEvaluationToState(null, ev({ evaluation_status: 'HEALTHY', time_window: { start: 'a', end: 'e1' } }), 't1');
    s = applyEvaluationToState(s.state, ev({ evaluation_status: 'HEALTHY', time_window: { start: 'a', end: 'e2' } }), 't2');
    expect(s.state.consecutive_healthy).toBe(2);
    s = applyEvaluationToState(s.state, ev({ evaluation_status: 'FIRING', time_window: { start: 'a', end: 'e3' } }), 't3');
    expect(s.state.consecutive_healthy).toBe(0);
  });
});
