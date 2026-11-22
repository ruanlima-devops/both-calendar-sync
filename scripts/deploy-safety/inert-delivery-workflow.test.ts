/**
 * C3-B.4 Entrega 2 — negative tests for inert delivery workflow allowlist.
 * Every mutation must remain UNKNOWN_BLOCKED (fail-closed).
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

function classifyWith(content: string, extraPaths: string[] = []) {
  return classifyDeployChanges([INERT_DELIVERY_WORKFLOW_PATH, ...extraPaths], {
    contentByPath: { [INERT_DELIVERY_WORKFLOW_PATH]: content },
  });
}

function expectBlocked(r: ReturnType<typeof classifyDeployChanges>) {
  expect(r.decision).toBe('UNKNOWN_BLOCKED');
  expect(r.may_skip_remote_deploy).toBe(false);
  expect(r.run_db).toBe(false);
  expect(r.run_functions).toBe(false);
}

describe('C3-B.4 inert delivery workflow allowlist', () => {
  it('certified bytes match pinned SHA256', () => {
    expect(sha256Hex(CERTIFIED)).toBe(INERT_DELIVERY_WORKFLOW_SHA256);
    const v = validateInertDeliveryWorkflowContent(CERTIFIED);
    expect(v.ok).toBe(true);
    expect(v.digest_ok).toBe(true);
    expect(v.structure_ok).toBe(true);
  });

  it('exact certified path+content → SAFE_SKIP', () => {
    const r = classifyWith(CERTIFIED);
    expect(r.decision).toBe('SAFE_SKIP');
    expect(r.run_db).toBe(false);
    expect(r.run_functions).toBe(false);
    expect(r.reasons).toContain('inert_delivery_workflow_certified');
  });

  it('N01 schedule → BLOCKED', () => {
    expectBlocked(classifyWith(mutate((s) => s.replace('on: {}', 'on:\n  schedule:\n    - cron: "0 * * * *"'))));
  });

  it('N02 workflow_dispatch → BLOCKED', () => {
    expectBlocked(classifyWith(mutate((s) => s.replace('on: {}', 'on:\n  workflow_dispatch:'))));
  });

  it('N03 workflow_run → BLOCKED', () => {
    expectBlocked(classifyWith(mutate((s) => s.replace('on: {}', 'on:\n  workflow_run:\n    workflows: ["CI"]\n    types: [completed]'))));
  });

  it('N04 pull_request_target → BLOCKED', () => {
    expectBlocked(classifyWith(mutate((s) => s.replace('on: {}', 'on:\n  pull_request_target:'))));
  });

  it('N05 push → BLOCKED', () => {
    expectBlocked(classifyWith(mutate((s) => s.replace('on: {}', 'on:\n  push:\n    branches: [develop]'))));
  });

  it('N06 pull_request → BLOCKED', () => {
    expectBlocked(classifyWith(mutate((s) => s.replace('on: {}', 'on:\n  pull_request:'))));
  });

  it('N07 repository_dispatch → BLOCKED', () => {
    expectBlocked(classifyWith(mutate((s) => s.replace('on: {}', 'on:\n  repository_dispatch:'))));
  });

  it('N08 issues:write → BLOCKED', () => {
    expectBlocked(
      classifyWith(mutate((s) => s.replace('contents: read', 'contents: read\n  issues: write'))),
    );
  });

  it('N09 contents:write → BLOCKED', () => {
    expectBlocked(classifyWith(mutate((s) => s.replace('contents: read', 'contents: write'))));
  });

  it('N10 actions:write → BLOCKED', () => {
    expectBlocked(
      classifyWith(mutate((s) => s.replace('contents: read', 'contents: read\n  actions: write'))),
    );
  });

  it('N11 secrets: → BLOCKED', () => {
    expectBlocked(
      classifyWith(
        mutate(
          (s) =>
            s +
            '\n# injected\n  fake:\n    secrets:\n      token: ${{ secrets.GITHUB_TOKEN }}\n',
        ),
      ),
    );
  });

  it('N12 env with token → BLOCKED', () => {
    expectBlocked(
      classifyWith(
        mutate((s) =>
          s.replace(
            'steps:',
            'env:\n      GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}\n    steps:',
          ),
        ),
      ),
    );
  });

  it('N13 curl → BLOCKED', () => {
    expectBlocked(classifyWith(mutate((s) => s.replace('exit 1', 'curl https://example.com\n          exit 1'))));
  });

  it('N14 gh issue create → BLOCKED', () => {
    expectBlocked(
      classifyWith(mutate((s) => s.replace('exit 1', 'gh issue create --title x\n          exit 1'))),
    );
  });

  it('N15 gh issue edit → BLOCKED', () => {
    expectBlocked(classifyWith(mutate((s) => s.replace('exit 1', 'gh issue edit 1\n          exit 1'))));
  });

  it('N16 gh issue close → BLOCKED', () => {
    expectBlocked(classifyWith(mutate((s) => s.replace('exit 1', 'gh issue close 1\n          exit 1'))));
  });

  it('N17 delivery real script → BLOCKED', () => {
    expectBlocked(
      classifyWith(
        mutate((s) => s.replace('exit 1', 'npx tsx scripts/syn05-watchdog/delivery.ts\n          exit 1')),
      ),
    );
  });

  it('N18 supabase db push → BLOCKED', () => {
    expectBlocked(
      classifyWith(mutate((s) => s.replace('exit 1', 'supabase db push\n          exit 1'))),
    );
  });

  it('N19 supabase functions deploy → BLOCKED', () => {
    expectBlocked(
      classifyWith(mutate((s) => s.replace('exit 1', 'supabase functions deploy\n          exit 1'))),
    );
  });

  it('N20 SQL → BLOCKED', () => {
    expectBlocked(classifyWith(mutate((s) => s.replace('exit 1', 'psql -c "select 1"\n          exit 1'))));
  });

  it('N21 reusable workflow → BLOCKED', () => {
    expectBlocked(
      classifyWith(
        mutate((s) =>
          s.replace(
            '- name: Refuse execution',
            '- name: Call reusable\n        uses: org/repo/.github/workflows/x.yml@main\n      - name: Refuse execution',
          ),
        ),
      ),
    );
  });

  it('N22 composite action side effects → BLOCKED', () => {
    expectBlocked(
      classifyWith(
        mutate((s) =>
          s.replace(
            '- name: Refuse execution',
            '- name: Composite\n        uses: actions/checkout@v4\n      - name: Refuse execution',
          ),
        ),
      ),
    );
  });

  it('N23 external URL → BLOCKED', () => {
    expectBlocked(
      classifyWith(mutate((s) => s.replace('exit 1', 'echo https://evil.example\n          exit 1'))),
    );
  });

  it('N24 dynamic steps → BLOCKED', () => {
    expectBlocked(
      classifyWith(
        mutate((s) =>
          s.replace('exit 1', 'echo ${{ toJSON(steps.x.outputs) }}\n          exit 1'),
        ),
      ),
    );
  });

  it('N25 job-level permissions write → BLOCKED', () => {
    expectBlocked(
      classifyWith(
        mutate((s) =>
          s.replace(
            'timeout-minutes: 5',
            'timeout-minutes: 5\n    permissions:\n      issues: write',
          ),
        ),
      ),
    );
  });

  it('N26 rename workflow path → BLOCKED', () => {
    const r = classifyDeployChanges(['.github/workflows/both-stage-watchdog-delivery-renamed.yml'], {
      contentByPath: {
        '.github/workflows/both-stage-watchdog-delivery-renamed.yml': CERTIFIED,
      },
    });
    expectBlocked(r);
  });

  it('N27 copy allowlist to other workflow → BLOCKED', () => {
    const r = classifyDeployChanges(['.github/workflows/other-watchdog-delivery.yml'], {
      contentByPath: { '.github/workflows/other-watchdog-delivery.yml': CERTIFIED },
    });
    expectBlocked(r);
  });

  it('N28 malformed YAML → BLOCKED', () => {
    expectBlocked(classifyWith('on: {\npermissions: [[[\n'));
  });

  it('N29 YAML alias/anchor hide behavior → BLOCKED', () => {
    expectBlocked(
      classifyWith(
        mutate((s) => s.replace('on: {}', 'x: &trig\n  workflow_dispatch:\non: *trig')),
      ),
    );
  });

  it('N30 equivalent trigger syntax → BLOCKED', () => {
    // Quoted "on" with push still blocked by digest + structure
    expectBlocked(classifyWith(mutate((s) => s.replace('on: {}', '"on":\n  push:'))));
  });

  it('N31 content change same filename → BLOCKED', () => {
    expectBlocked(classifyWith(mutate((s) => s + '\n# innocuous comment change\n')));
  });

  it('N32 mixed with migration → BLOCKED', () => {
    expectBlocked(
      classifyWith(CERTIFIED, ['supabase/migrations/20261122000001_x.sql']),
    );
  });

  it('N33 mixed with Edge Function → BLOCKED', () => {
    expectBlocked(classifyWith(CERTIFIED, ['supabase/functions/google-oauth/index.ts']));
  });

  it('N34 mixed with deploy-stage.yml → BLOCKED', () => {
    expectBlocked(classifyWith(CERTIFIED, ['.github/workflows/deploy-stage.yml']));
  });

  it('missing content fail-closed', () => {
    const r = classifyDeployChanges([INERT_DELIVERY_WORKFLOW_PATH], {
      contentByPath: { [INERT_DELIVERY_WORKFLOW_PATH]: null },
    });
    expectBlocked(r);
  });

  it('filename alone without certified digest never SAFE_SKIP', () => {
    const r = classifyWith('name: fake\non: {}\n');
    expectBlocked(r);
    expect(r.reasons.join(' ')).toMatch(/inert_delivery_digest_mismatch|unclassified/);
  });
});
