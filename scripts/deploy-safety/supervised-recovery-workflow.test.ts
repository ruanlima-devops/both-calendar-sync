/**
 * C3-C — supervised recovery workflow Deploy Safety allowlist negatives.
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

describe('C3-C supervised recovery workflow', () => {
  it('certified digest + structure', () => {
    expect(sha256Hex(CERTIFIED)).toBe(SUPERVISED_RECOVERY_WORKFLOW_SHA256);
    expect(validateSupervisedRecoveryWorkflowContent(CERTIFIED).ok).toBe(true);
  });

  it('SAFE_SKIP for certified content', () => {
    const r = classifyWith(CERTIFIED);
    expect(r.decision).toBe('SAFE_SKIP');
    expect(r.reasons).toContain('supervised_recovery_workflow_certified');
    expect(r.run_db).toBe(false);
    expect(r.run_functions).toBe(false);
  });

  it('SAFE_SKIP with watchdog scripts', () => {
    const r = classifyDeployChanges(
      [SUPERVISED_RECOVERY_WORKFLOW_PATH, 'scripts/syn05-watchdog/c3c-recovery.ts'],
      { contentByPath: { [SUPERVISED_RECOVERY_WORKFLOW_PATH]: CERTIFIED } },
    );
    expect(r.decision).toBe('SAFE_SKIP');
  });

  it('blocks schedule/push/PR/workflow_run', () => {
    expectBlocked(
      classifyWith(
        mutate((s) =>
          s.replace('"on":\n  workflow_dispatch:', '"on":\n  schedule:\n    - cron: "0 * * * *"\n  workflow_dispatch:'),
        ),
      ),
    );
    expectBlocked(
      classifyWith(
        mutate((s) =>
          s.replace('"on":\n  workflow_dispatch:', '"on":\n  push:\n    branches: [develop]\n  workflow_dispatch:'),
        ),
      ),
    );
  });

  it('blocks digest drift', () => {
    expectBlocked(classifyWith(mutate((s) => s + '\n# drift\n')));
  });

  it('blocks near-miss path', () => {
    const r = classifyDeployChanges(['.github/workflows/both-stage-watchdog-recovery-extra.yml']);
    expect(r.decision).toBe('UNKNOWN_BLOCKED');
  });

  it('blocks mixed with deploy-stage', () => {
    const r = classifyDeployChanges(
      [SUPERVISED_RECOVERY_WORKFLOW_PATH, '.github/workflows/deploy-stage.yml'],
      { contentByPath: { [SUPERVISED_RECOVERY_WORKFLOW_PATH]: CERTIFIED } },
    );
    expect(r.decision).toBe('UNKNOWN_BLOCKED');
  });

  it('blocks removing recovery CLI', () => {
    expectBlocked(
      classifyWith(mutate((s) => s.replace('c3c-recovery-cli.ts', 'evil-cli.ts'))),
    );
  });

  it('blocks secrets / supabase / curl', () => {
    expectBlocked(classifyWith(mutate((s) => s + '\n      - run: echo ${{ secrets.X }}\n')));
    expectBlocked(classifyWith(mutate((s) => s + '\n      - run: supabase db push\n')));
    expectBlocked(classifyWith(mutate((s) => s + '\n      - run: curl https://evil\n')));
  });
});
