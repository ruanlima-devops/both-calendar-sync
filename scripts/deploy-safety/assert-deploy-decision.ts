/**
 * SYN-05 C0.5 — consume classifier JSON and emit GITHUB_OUTPUT.
 * Fail-closed: missing/invalid/tampered → exit 3, run_db=false, run_functions=false.
 */

import { readFileSync, existsSync, appendFileSync } from 'node:fs';
import type { ClassifyResult, DeployDecision } from './classify-deploy-changes';

const ALLOWED: DeployDecision[] = [
  'SAFE_SKIP',
  'DEPLOY_CANDIDATE_DB',
  'DEPLOY_CANDIDATE_FUNCTIONS',
  'DEPLOY_CANDIDATE_BOTH',
  'BOOTSTRAP_REVIEW',
  'REQUIRES_REVIEW',
  'UNKNOWN_BLOCKED',
];

export type AssertResult = {
  ok: boolean;
  decision: DeployDecision | 'INVALID';
  run_db: boolean;
  run_functions: boolean;
  skip_remote: boolean;
  reason: string;
};

export function assertDeployDecision(jsonPath: string, expectedRef?: string, actualRef?: string): AssertResult {
  if (expectedRef && actualRef && expectedRef !== actualRef) {
    return {
      ok: false,
      decision: 'INVALID',
      run_db: false,
      run_functions: false,
      skip_remote: false,
      reason: 'project_ref_mismatch',
    };
  }
  if (!existsSync(jsonPath)) {
    return {
      ok: false,
      decision: 'INVALID',
      run_db: false,
      run_functions: false,
      skip_remote: false,
      reason: 'decision_file_missing',
    };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(jsonPath, 'utf8'));
  } catch {
    return {
      ok: false,
      decision: 'INVALID',
      run_db: false,
      run_functions: false,
      skip_remote: false,
      reason: 'decision_json_invalid',
    };
  }
  if (!parsed || typeof parsed !== 'object') {
    return {
      ok: false,
      decision: 'INVALID',
      run_db: false,
      run_functions: false,
      skip_remote: false,
      reason: 'decision_not_object',
    };
  }
  const r = parsed as Partial<ClassifyResult>;
  if (!r.decision || !ALLOWED.includes(r.decision as DeployDecision)) {
    return {
      ok: false,
      decision: 'INVALID',
      run_db: false,
      run_functions: false,
      skip_remote: false,
      reason: 'decision_unknown_value',
    };
  }
  const decision = r.decision as DeployDecision;
  if (decision === 'SAFE_SKIP') {
    if (r.may_skip_remote_deploy !== true || r.run_db === true || r.run_functions === true) {
      return {
        ok: false,
        decision: 'INVALID',
        run_db: false,
        run_functions: false,
        skip_remote: false,
        reason: 'safe_skip_tampered',
      };
    }
    return {
      ok: true,
      decision,
      run_db: false,
      run_functions: false,
      skip_remote: true,
      reason: 'safe_skip',
    };
  }
  // Any non-SAFE_SKIP: do not auto-run deploy in C0.5 bootstrap mode unless
  // DEPLOY_SAFETY_ALLOW_CANDIDATE=1 AND decision is a DEPLOY_CANDIDATE_* .
  // Default fail-closed: candidates require explicit release gate (Gate D).
  const allowCandidate = process.env.DEPLOY_SAFETY_ALLOW_CANDIDATE === '1';
  const isCandidate =
    decision === 'DEPLOY_CANDIDATE_DB' ||
    decision === 'DEPLOY_CANDIDATE_FUNCTIONS' ||
    decision === 'DEPLOY_CANDIDATE_BOTH';

  if (!isCandidate || !allowCandidate) {
    return {
      ok: true,
      decision,
      run_db: false,
      run_functions: false,
      skip_remote: false,
      reason: isCandidate ? 'candidate_blocked_until_release_gate' : `blocked_${decision.toLowerCase()}`,
    };
  }

  return {
    ok: true,
    decision,
    run_db: !!r.run_db,
    run_functions: !!r.run_functions,
    skip_remote: false,
    reason: 'candidate_allowed',
  };
}

function writeOutput(result: AssertResult): void {
  const out = process.env.GITHUB_OUTPUT;
  const lines = [
    `decision=${result.decision}`,
    `run_db=${result.run_db}`,
    `run_functions=${result.run_functions}`,
    `skip_remote=${result.skip_remote}`,
    `assert_ok=${result.ok}`,
    `reason=${result.reason}`,
  ];
  if (out) {
    appendFileSync(out, lines.join('\n') + '\n');
  }
  console.log(JSON.stringify(result));
}

const isMain =
  !!process.argv[1] &&
  (process.argv[1].endsWith('/assert-deploy-decision.ts') ||
    process.argv[1].endsWith('\\assert-deploy-decision.ts'));

if (isMain) {
  const jsonPath = process.argv[2];
  if (!jsonPath) {
    console.error('usage: assert-deploy-decision.ts <decision.json>');
    process.exitCode = 2;
  } else {
    const expected = process.env.DEPLOY_EXPECTED_PROJECT_REF;
    const actual = process.env.DEPLOY_ACTUAL_PROJECT_REF;
    const result = assertDeployDecision(jsonPath, expected, actual);
    writeOutput(result);
    if (!result.ok) process.exitCode = 3;
    // BOOTSTRAP_REVIEW / UNKNOWN / REQUIRES_REVIEW fail the job so merge cannot silently skip
    if (
      result.decision === 'BOOTSTRAP_REVIEW' ||
      result.decision === 'UNKNOWN_BLOCKED' ||
      result.decision === 'REQUIRES_REVIEW' ||
      result.decision === 'INVALID'
    ) {
      process.exitCode = 2;
    }
  }
}
