/**
 * C3-C FINAL OFF — recovery workflow allowlist negatives.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { classifyDeployChanges } from './classify-deploy-changes.ts';
import {
  SUPERVISED_RECOVERY_WORKFLOW_PATH,
  SUPERVISED_RECOVERY_WORKFLOW_SHA256,
  sha256Hex,
  validateSupervisedRecoveryWorkflowContent,
} from './supervised-recovery-workflow.ts';

const CERTIFIED = readFileSync(
  new URL('../../.github/workflows/both-stage-watchdog-recovery.yml', import.meta.url),
  'utf8',
);

function mutate(transform: (s: string) => string): string {
  return transform(CERTIFIED);
}

function classifyWith(content: string, extra: string[] = []) {
  return classifyDeployChanges([SUPERVISED_RECOVERY_WORKFLOW_PATH, ...extra], {
    contentByPath: { [SUPERVISED_RECOVERY_WORKFLOW_PATH]: content },
  });
}

function expectBlocked(r: ReturnType<typeof classifyDeployChanges>) {
  expect(r.decision).toBe('UNKNOWN_BLOCKED');
  expect(r.run_db).toBe(false);
  expect(r.run_functions).toBe(false);
}

describe('C3-C FINAL OFF recovery workflow', () => {
  it('certified digest + structure', () => {
    expect(sha256Hex(CERTIFIED)).toBe(SUPERVISED_RECOVERY_WORKFLOW_SHA256);
    expect(validateSupervisedRecoveryWorkflowContent(CERTIFIED).ok).toBe(true);
  });

  it('SAFE_SKIP for certified OFF content', () => {
    const r = classifyWith(CERTIFIED);
    expect(r.decision).toBe('SAFE_SKIP');
    expect(r.reasons).toContain('supervised_recovery_workflow_certified');
  });

  it('blocks schedule/push', () => {
    expectBlocked(
      classifyWith(
        mutate((s) =>
          s.replace('"on":\n  workflow_dispatch:', '"on":\n  schedule:\n    - cron: "0 * * * *"\n  workflow_dispatch:'),
        ),
      ),
    );
  });

  it('blocks issues:write reintroduction', () => {
    expectBlocked(
      classifyWith(
        mutate((s) =>
          s.replace('contents: read\n\nconcurrency:', 'contents: read\n  issues: write\n\nconcurrency:'),
        ),
      ),
    );
  });

  it('blocks supervised job / CLI reintroduction', () => {
    expectBlocked(
      classifyWith(
        mutate(
          (s) =>
            s +
            '\n  delivery-supervised-recovery:\n    runs-on: ubuntu-latest\n    steps:\n      - run: node --experimental-strip-types scripts/syn05-watchdog/c3c-recovery-cli.ts\n',
        ),
      ),
    );
  });

  it('blocks digest drift', () => {
    expectBlocked(classifyWith(mutate((s) => s + '\n# drift\n')));
  });

  it('blocks mixed with deploy-stage', () => {
    const r = classifyDeployChanges(
      [SUPERVISED_RECOVERY_WORKFLOW_PATH, '.github/workflows/deploy-stage.yml'],
      { contentByPath: { [SUPERVISED_RECOVERY_WORKFLOW_PATH]: CERTIFIED } },
    );
    expect(r.decision).toBe('UNKNOWN_BLOCKED');
  });
});
