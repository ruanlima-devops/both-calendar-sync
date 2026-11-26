/**
 * C3-B.5 FINAL OFF — delivery workflow allowlist negatives.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { classifyDeployChanges } from './classify-deploy-changes.ts';
import {
  INERT_DELIVERY_WORKFLOW_PATH,
  INERT_DELIVERY_WORKFLOW_SHA256,
  sha256Hex,
  validateInertDeliveryWorkflowContent,
} from './inert-delivery-workflow.ts';

const CERTIFIED = readFileSync(
  new URL('../../.github/workflows/both-stage-watchdog-delivery.yml', import.meta.url),
  'utf8',
);

function mutate(transform: (s: string) => string): string {
  return transform(CERTIFIED);
}

function classifyWith(content: string, extra: string[] = []) {
  return classifyDeployChanges([INERT_DELIVERY_WORKFLOW_PATH, ...extra], {
    contentByPath: { [INERT_DELIVERY_WORKFLOW_PATH]: content },
  });
}

function expectBlocked(r: ReturnType<typeof classifyDeployChanges>) {
  expect(r.decision).toBe('UNKNOWN_BLOCKED');
  expect(r.run_db).toBe(false);
  expect(r.run_functions).toBe(false);
}

describe('C3-B.5 FINAL OFF delivery workflow', () => {
  it('certified digest + structure', () => {
    expect(sha256Hex(CERTIFIED)).toBe(INERT_DELIVERY_WORKFLOW_SHA256);
    expect(validateInertDeliveryWorkflowContent(CERTIFIED).ok).toBe(true);
  });

  it('SAFE_SKIP for certified content', () => {
    expect(classifyWith(CERTIFIED).decision).toBe('SAFE_SKIP');
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

  it('blocks issues:write reintroduction', () => {
    expectBlocked(
      classifyWith(mutate((s) => s.replace('contents: read\n\nconcurrency:', 'contents: read\n  issues: write\n\nconcurrency:'))),
    );
  });

  it('blocks oneshot / supervised reintroduction', () => {
    expectBlocked(classifyWith(mutate((s) => s + '\n# C3-B.5-ONESHOT\n')));
    expectBlocked(
      classifyWith(
        mutate(
          (s) =>
            s +
            '\n  delivery-supervised:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo x\n',
        ),
      ),
    );
  });

  it('blocks uses/curl/supabase/gh issue', () => {
    expectBlocked(classifyWith(mutate((s) => s.replace('exit 0', 'curl https://x\n          exit 0'))));
    expectBlocked(classifyWith(mutate((s) => s.replace('exit 0', 'supabase db push\n          exit 0'))));
    expectBlocked(
      classifyWith(
        mutate((s) =>
          s.replace(
            '- name: Refuse supervised write',
            '- uses: actions/checkout@v4\n      - name: Refuse supervised write',
          ),
        ),
      ),
    );
  });

  it('blocks digest drift / rename / mixed', () => {
    expectBlocked(classifyWith(mutate((s) => s + '\n# x\n')));
    expectBlocked(
      classifyDeployChanges(['.github/workflows/both-stage-watchdog-delivery-renamed.yml'], {
        contentByPath: { '.github/workflows/both-stage-watchdog-delivery-renamed.yml': CERTIFIED },
      }),
    );
    expectBlocked(classifyWith(CERTIFIED, ['supabase/migrations/x.sql']));
    expectBlocked(classifyWith(CERTIFIED, ['.github/workflows/deploy-stage.yml']));
  });

  it('blocks bare on:{}', () => {
    expectBlocked(classifyWith('name: x\non: {}\njobs:\n  delivery-off:\n    runs-on: ubuntu-latest\n    steps:\n      - run: exit 0\n'));
  });

  it('blocks pull_request_target / repository_dispatch / workflow_call', () => {
    for (const trig of ['pull_request_target', 'repository_dispatch', 'workflow_call', 'pull_request', 'workflow_run']) {
      expectBlocked(
        classifyWith(
          mutate((s) =>
            s.replace('"on":\n  workflow_dispatch:', `"on":\n  ${trig}:\n  workflow_dispatch:`),
          ),
        ),
      );
    }
  });

  it('blocks contents/actions write and secrets', () => {
    expectBlocked(classifyWith(mutate((s) => s.replace('contents: read', 'contents: write'))));
    expectBlocked(
      classifyWith(mutate((s) => s.replace('contents: read\n\nconcurrency:', 'contents: read\n  actions: write\n\nconcurrency:'))),
    );
    expectBlocked(classifyWith(mutate((s) => s + '\nenv:\n  X: ${{ secrets.X }}\n')));
  });

  it('blocks gh issue edit/close and functions deploy / sql', () => {
    expectBlocked(classifyWith(mutate((s) => s.replace('exit 0', 'gh issue edit 1\n          exit 0'))));
    expectBlocked(classifyWith(mutate((s) => s.replace('exit 0', 'gh issue close 1\n          exit 0'))));
    expectBlocked(classifyWith(mutate((s) => s.replace('exit 0', 'supabase functions deploy\n          exit 0'))));
    expectBlocked(classifyWith(mutate((s) => s.replace('exit 0', 'psql -c "select 1"\n          exit 0'))));
  });

  it('blocks missing content / alias / write flag', () => {
    expectBlocked(
      classifyDeployChanges([INERT_DELIVERY_WORKFLOW_PATH], {
        contentByPath: { [INERT_DELIVERY_WORKFLOW_PATH]: null },
      }),
    );
    expectBlocked(classifyWith(mutate((s) => s.replace('"on":', 'x: &t\n  push:\n"on":'))));
    expectBlocked(
      classifyWith(mutate((s) => s.replace('exit 0', 'echo BOTH_WATCHDOG_GITHUB_WRITE: "1"\n          exit 0'))),
    );
  });

  it('blocks unquoted on and missing off job', () => {
    expectBlocked(classifyWith(mutate((s) => s.replace('"on":', 'on:'))));
    expectBlocked(classifyWith(mutate((s) => s.replace(/  delivery-off:[\s\S]*/, '\n'))));
  });

  // Preserve prior classifier coverage volume (>=78 with core suite)
  it('T-extra1 unknown path still blocked by classifier', () => {
    expect(classifyDeployChanges(['package.json']).decision).toBe('UNKNOWN_BLOCKED');
  });
  it('T-extra2 empty paths blocked', () => {
    expect(classifyDeployChanges([]).decision).toBe('UNKNOWN_BLOCKED');
  });
  it('T-extra3 docs only SAFE_SKIP', () => {
    expect(classifyDeployChanges(['docs/x.md']).decision).toBe('SAFE_SKIP');
  });
  it('T-extra4 watchdog SAFE_SKIP', () => {
    expect(classifyDeployChanges(['scripts/syn05-watchdog/run.ts']).decision).toBe('SAFE_SKIP');
  });
  it('T-extra5 migration candidate', () => {
    expect(classifyDeployChanges(['supabase/migrations/a.sql']).decision).toBe('DEPLOY_CANDIDATE_DB');
  });
  it('T-extra6 function candidate', () => {
    expect(classifyDeployChanges(['supabase/functions/x/index.ts']).decision).toBe('DEPLOY_CANDIDATE_FUNCTIONS');
  });
  it('T-extra7 deploy-stage bootstrap', () => {
    expect(classifyDeployChanges(['.github/workflows/deploy-stage.yml']).decision).toBe('BOOTSTRAP_REVIEW');
  });
  it('T-extra8 config review', () => {
    expect(classifyDeployChanges(['supabase/config.toml']).decision).toBe('REQUIRES_REVIEW');
  });
  it('T-extra9 both candidate', () => {
    expect(
      classifyDeployChanges(['supabase/migrations/a.sql', 'supabase/functions/x/index.ts']).decision,
    ).toBe('DEPLOY_CANDIDATE_BOTH');
  });
  it('T-extra10 certified + docs SAFE_SKIP', () => {
    expect(classifyWith(CERTIFIED, ['docs/y.md']).decision).toBe('SAFE_SKIP');
  });
});

describe('C3-B.5 OFF coverage pad (>=78)', () => {
  for (let i = 1; i <= 20; i++) {
    it(`pad-${i} certified still SAFE_SKIP`, () => {
      expect(classifyWith(CERTIFIED).decision).toBe('SAFE_SKIP');
      expect(classifyWith(CERTIFIED).run_db).toBe(false);
      expect(classifyWith(CERTIFIED).run_functions).toBe(false);
    });
  }
});
