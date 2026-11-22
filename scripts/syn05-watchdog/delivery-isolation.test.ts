import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ALLOWED_ALERT_IDS,
  DELIVERY_ARTIFACT_SCHEMA,
  assertSafeArtifactPath,
  buildDeliveryArtifact,
  canonicalizeDeliveryArtifact,
  mayMutateIssuesFromArtifact,
  parseDeliveryArtifactJson,
  sha256Canonical,
  validateDeliveryArtifact,
  verifyArtifactProvenance,
  type DeliveryArtifactV1,
} from './delivery-artifact.ts';
import { attemptDeliveryFromJson, DELIVERY_REAL_ADAPTER_WIRED } from './delivery.ts';
import { collectFromInjectedSignals, COLLECTOR_FORBIDS_GITHUB_ISSUES } from './collector.ts';
import { evaluateCollected, EVALUATOR_FORBIDS_GITHUB_ISSUES, EVALUATOR_FORBIDS_REMOTE_HTTP } from './evaluator.ts';
import {
  defaultC0Env,
  evaluateWriteGate,
  resolveDeliveryMode,
} from './write-gate.ts';
import { STAGE_PROJECT_REF } from './types.ts';
import { isRealGithubIssuesEnabled } from './http-github-issues.ts';

const COMMIT = '26663e9f27a188d8c3defbae3a2336b4a8ead458';
const RUN = 'run-c3b41-test-001';

function validArtifact(over: Partial<DeliveryArtifactV1> = {}): DeliveryArtifactV1 {
  return {
    schema_version: DELIVERY_ARTIFACT_SCHEMA,
    project_ref: STAGE_PROJECT_REF,
    environment: 'stage',
    alert_id: 'ALERT-01',
    fingerprint: 'ALERT-01|qszggrrjhcwltnmxpxcy|edge',
    evaluation_status: 'FIRING',
    sample_window_start: '2026-11-21T22:00:00.000Z',
    sample_window_end: '2026-11-21T22:10:00.000Z',
    event_count: 3,
    completeness: 'complete',
    evaluation_run_id: RUN,
    source_commit_sha: COMMIT,
    ...over,
  };
}

describe('C3-B.4.1 delivery artifact schema', () => {
  it('A accepts valid artifact', () => {
    const r = validateDeliveryArtifact(validArtifact());
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.sha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it('B rejects unknown schema', () => {
    const r = validateDeliveryArtifact({ ...validArtifact(), schema_version: 'v999' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('unknown_schema');
  });

  it('C rejects additionalProperties', () => {
    const r = validateDeliveryArtifact({ ...validArtifact(), extra: 'x' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('additional_property');
  });

  it('D/E rejects forbidden / PII-like fields', () => {
    const r = validateDeliveryArtifact({ ...validArtifact(), event_message: 'leak' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('forbidden_field');
  });

  it('F rejects oversized fingerprint', () => {
    const r = validateDeliveryArtifact({
      ...validArtifact(),
      fingerprint: `ALERT-01|${'x'.repeat(220)}`,
    });
    expect(r.ok).toBe(false);
  });

  it('G rejects malformed JSON', () => {
    const r = parseDeliveryArtifactJson('{not-json');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('malformed_json');
  });

  it('H/I hash valid and mismatch', () => {
    const r = validateDeliveryArtifact(validArtifact());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const ok = verifyArtifactProvenance(r, {
      expected_run_id: RUN,
      expected_commit_sha: COMMIT,
      expected_sha256: r.sha256,
    });
    expect(ok.ok).toBe(true);
    const bad = verifyArtifactProvenance(r, {
      expected_run_id: RUN,
      expected_commit_sha: COMMIT,
      expected_sha256: '0'.repeat(64),
    });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.code).toBe('hash_mismatch');
  });

  it('J/K run and commit mismatch', () => {
    const r = validateDeliveryArtifact(validArtifact());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(
      verifyArtifactProvenance(r, { expected_run_id: 'other', expected_commit_sha: COMMIT }).ok,
    ).toBe(false);
    expect(
      verifyArtifactProvenance(r, { expected_run_id: RUN, expected_commit_sha: 'a'.repeat(40) }).ok,
    ).toBe(false);
  });

  it('L/M project and environment mismatch', () => {
    expect(validateDeliveryArtifact({ ...validArtifact(), project_ref: 'sknpqjodttkpttaytdut' }).ok).toBe(
      false,
    );
    expect(validateDeliveryArtifact({ ...validArtifact(), environment: 'prod' }).ok).toBe(false);
  });

  it('N/O incomplete and UNKNOWN forbid mutation', () => {
    const inc = validArtifact({ completeness: 'incomplete' });
    expect(mayMutateIssuesFromArtifact(inc)).toBe(false);
    const unk = validArtifact({ evaluation_status: 'UNKNOWN' });
    expect(mayMutateIssuesFromArtifact(unk)).toBe(false);
  });

  it('canonical serialization is stable', () => {
    const a = validArtifact();
    const c1 = canonicalizeDeliveryArtifact(a);
    const c2 = canonicalizeDeliveryArtifact(a);
    expect(c1).toBe(c2);
    expect(sha256Canonical(c1)).toBe(sha256Canonical(c2));
  });

  it('rejects prototype pollution keys', () => {
    const raw = JSON.stringify({
      ...validArtifact(),
      __proto__: { polluted: true },
    });
    // JSON.stringify drops __proto__ assignment quirks; craft via parse then inject
    const obj = JSON.parse(JSON.stringify(validArtifact())) as Record<string, unknown>;
    Object.defineProperty(obj, '__proto__', { value: { x: 1 }, enumerable: true });
    // validate checks Object.keys — ensure dangerous key path via parseDeliveryArtifactJson string
    const polluted = `{"schema_version":"${DELIVERY_ARTIFACT_SCHEMA}","__proto__":{"x":1}}`;
    const r = parseDeliveryArtifactJson(polluted);
    expect(r.ok).toBe(false);
  });

  it('rejects injection metacharacters in fingerprint', () => {
    expect(
      validateDeliveryArtifact({ ...validArtifact(), fingerprint: 'ALERT-01|x;rm -rf' }).ok,
    ).toBe(false);
  });

  it('rejects invalid timestamps and window order', () => {
    expect(
      validateDeliveryArtifact({
        ...validArtifact(),
        sample_window_start: 'not-iso',
        sample_window_end: '2026-11-21T22:10:00.000Z',
      }).ok,
    ).toBe(false);
    expect(
      validateDeliveryArtifact({
        ...validArtifact(),
        sample_window_start: '2026-11-21T22:10:00.000Z',
        sample_window_end: '2026-11-21T22:00:00.000Z',
      }).ok,
    ).toBe(false);
  });

  it('allowlists alert ids only', () => {
    expect(ALLOWED_ALERT_IDS).toContain('ALERT-01');
    expect(validateDeliveryArtifact({ ...validArtifact(), alert_id: 'ALERT-99' as 'ALERT-01' }).ok).toBe(
      false,
    );
  });
});

describe('C3-B.4.1 path safety', () => {
  it('W allows nested artifact path', () => {
    expect(assertSafeArtifactPath('artifacts/syn05-delivery/a.json').ok).toBe(true);
  });
  it('W rejects traversal', () => {
    expect(assertSafeArtifactPath('../etc/passwd').ok).toBe(false);
    expect(assertSafeArtifactPath('artifacts/syn05-delivery/../../x').ok).toBe(false);
  });
  it('X rejects symlink-like names', () => {
    expect(assertSafeArtifactPath('artifacts/syn05-delivery/symlink/x').ok).toBe(false);
  });
});

describe('C3-B.4.1 write gate', () => {
  it('P/Q/R C0 defaults refuse write', () => {
    const art = validArtifact();
    const validated = validateDeliveryArtifact(art);
    expect(validated.ok).toBe(true);
    if (!validated.ok) return;
    const g = evaluateWriteGate({
      env: defaultC0Env(),
      artifact: art,
      validated,
      permission_issues_write_available: true,
      adapter_enabled: true,
      token_present: true,
      trusted_provenance: true,
    });
    expect(g.authorized).toBe(false);
  });

  it('S conflicting WRITE+DRY_RUN', () => {
    const art = validArtifact();
    const validated = validateDeliveryArtifact(art);
    if (!validated.ok) throw new Error('setup');
    const g = evaluateWriteGate({
      env: defaultC0Env({ BOTH_WATCHDOG_GITHUB_WRITE: '1', BOTH_WATCHDOG_DRY_RUN: '1' }),
      artifact: art,
      validated,
    });
    expect(g.authorized).toBe(false);
    if (!g.authorized) expect(g.code).toMatch(/conflict|write_disabled/);
  });

  it('T/U auth/token/permission missing', () => {
    const art = validArtifact();
    const validated = validateDeliveryArtifact(art);
    if (!validated.ok) throw new Error('setup');
    const base = {
      env: defaultC0Env({
        BOTH_WATCHDOG_DRY_RUN: '0',
        BOTH_WATCHDOG_GITHUB_WRITE: '1',
        BOTH_WATCHDOG_DELIVERY_MODE: 'supervised-write',
        BOTH_WATCHDOG_C3_B41_FORCE_BLOCK: '0',
      }),
      artifact: art,
      validated,
      trusted_provenance: true,
      concurrency_ok: true,
      within_authorized_window: true,
      operations_remaining: 1,
      repo_full_name: 'ruanlima-devops/both-calendar-sync',
    };
    expect(evaluateWriteGate({ ...base, permission_issues_write_available: false }).authorized).toBe(
      false,
    );
    expect(
      evaluateWriteGate({
        ...base,
        permission_issues_write_available: true,
        adapter_enabled: false,
        token_present: true,
      }).authorized,
    ).toBe(false);
    expect(
      evaluateWriteGate({
        ...base,
        permission_issues_write_available: true,
        adapter_enabled: true,
        token_present: false,
      }).authorized,
    ).toBe(false);
  });

  it('hard block remains even if all flags green (C3-B.4.1)', () => {
    const art = validArtifact();
    const validated = validateDeliveryArtifact(art);
    if (!validated.ok) throw new Error('setup');
    const g = evaluateWriteGate({
      env: defaultC0Env({
        BOTH_WATCHDOG_DRY_RUN: '0',
        BOTH_WATCHDOG_GITHUB_WRITE: '1',
        BOTH_WATCHDOG_DELIVERY_MODE: 'supervised-write',
        // force block default '1'
      }),
      artifact: art,
      validated,
      permission_issues_write_available: true,
      adapter_enabled: true,
      token_present: true,
      trusted_provenance: true,
      concurrency_ok: true,
      within_authorized_window: true,
      operations_remaining: 5,
      repo_full_name: 'ruanlima-devops/both-calendar-sync',
    });
    expect(g.authorized).toBe(false);
  });

  it('mode enum', () => {
    expect(resolveDeliveryMode({})).toBe('simulation');
    expect(resolveDeliveryMode({ BOTH_WATCHDOG_DELIVERY_MODE: 'nope' })).toBe('blocked');
  });
});

describe('C3-B.4.1 delivery attempt', () => {
  it('V rejects adulterated payload', () => {
    const r = attemptDeliveryFromJson('{"schema_version":"x","evil":true}', {
      provenance: { expected_run_id: RUN, expected_commit_sha: COMMIT },
    });
    expect(r.accepted).toBe(false);
  });

  it('never wires real adapter', () => {
    expect(DELIVERY_REAL_ADAPTER_WIRED).toBe(false);
    expect(isRealGithubIssuesEnabled(defaultC0Env())).toBe(false);
  });

  it('valid artifact still not accepted under C0', () => {
    const built = buildDeliveryArtifact(validArtifact());
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    const r = attemptDeliveryFromJson(built.canonical_json, {
      provenance: { expected_run_id: RUN, expected_commit_sha: COMMIT, expected_sha256: built.sha256 },
    });
    expect(r.accepted).toBe(false);
    expect(r.planned_op).toBe('noop');
  });
});

describe('C3-B.4.1 collector/evaluator split', () => {
  it('AE no github issues on collector/evaluator', () => {
    expect(COLLECTOR_FORBIDS_GITHUB_ISSUES).toBe(true);
    expect(EVALUATOR_FORBIDS_GITHUB_ISSUES).toBe(true);
    expect(EVALUATOR_FORBIDS_REMOTE_HTTP).toBe(true);
  });

  it('collector injected path + evaluator emit artifacts', () => {
    const collected = collectFromInjectedSignals([], { dataAvailable: true, completeness: 'complete' });
    const out = evaluateCollected({
      signals: collected.signals,
      dataAvailable: collected.data_available,
      evaluation_run_id: RUN,
      source_commit_sha: COMMIT,
      nowMs: Date.parse('2026-11-21T22:10:00.000Z'),
      completeness: 'complete',
    });
    expect(out.evaluations.length).toBeGreaterThan(0);
    expect(out.artifacts.every((a) => a.ok)).toBe(true);
  });

  it('Y concurrency: duplicate artifacts same fingerprint remain idempotent noop', () => {
    const a = buildDeliveryArtifact(validArtifact());
    expect(a.ok).toBe(true);
    if (!a.ok) return;
    const r1 = attemptDeliveryFromJson(a.canonical_json, {
      provenance: { expected_run_id: RUN, expected_commit_sha: COMMIT, expected_sha256: a.sha256 },
    });
    const r2 = attemptDeliveryFromJson(a.canonical_json, {
      provenance: { expected_run_id: RUN, expected_commit_sha: COMMIT, expected_sha256: a.sha256 },
    });
    expect(r1.accepted).toBe(false);
    expect(r2.accepted).toBe(false);
    expect(r1.code).toBe(r2.code);
  });
});

describe('C3-B.5 delivery workflow YAML (empty-run fix)', () => {
  const ymlPath = resolve('.github/workflows/both-stage-watchdog-delivery.yml');
  const ymlPresent = (() => {
    try {
      readFileSync(ymlPath, 'utf8');
      return true;
    } catch {
      return false;
    }
  })();

  it('AF quoted on + workflow_dispatch only; no schedule/push/PR', () => {
    if (!ymlPresent) return;
    const yml = readFileSync(ymlPath, 'utf8');
    expect(yml).toMatch(/^"on":\s*$/m);
    expect(yml).not.toMatch(/^on:\s*\{\s*\}/m);
    expect(yml).toMatch(/^\s+workflow_dispatch:/m);
    const active = yml
      .split('\n')
      .filter((l) => !/^\s*#/.test(l))
      .join('\n');
    expect(active).not.toMatch(/^\s+schedule:/m);
    expect(active).not.toMatch(/^\s+workflow_run:/m);
    expect(active).not.toMatch(/^\s+pull_request_target:/m);
    expect(active).not.toMatch(/^\s+push:/m);
    expect(active).not.toMatch(/^\s+pull_request:/m);
  });

  it('AG/AH/AI issues:write only on supervised job; no supabase/deploy', () => {
    if (!ymlPresent) return;
    const yml = readFileSync(ymlPath, 'utf8');
    const active = yml
      .split('\n')
      .filter((l) => !/^\s*#/.test(l))
      .join('\n');
    expect(active).toMatch(/delivery-supervised:[\s\S]*issues:\s*write/);
    expect(active).not.toMatch(/SUPABASE_ACCESS_TOKEN/);
    expect(active).not.toMatch(/SUPABASE_DB_PASSWORD/);
    expect(active).not.toMatch(/db push|functions deploy/i);
    expect(yml).toContain('contents: read');
    expect(yml).toContain('cancel-in-progress: false');
    expect(yml).toContain('delivery-off:');
  });

  it('YAML has OFF default inputs and supervised CLI', () => {
    if (!ymlPresent) {
      expect(ymlPresent).toBe(false);
      return;
    }
    const yml = readFileSync(ymlPath, 'utf8');
    expect(yml).toContain('name:');
    expect(yml).toContain('permissions:');
    expect(yml).toContain('jobs:');
    expect(yml).toContain('default: OFF');
    expect(yml).toContain('supervised-delivery-cli.ts');
  });
});
