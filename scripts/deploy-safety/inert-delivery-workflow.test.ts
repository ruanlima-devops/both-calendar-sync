/**
 * C3-B.5 — negative tests for certified delivery workflow allowlist.
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

describe('C3-B.5 certified delivery workflow allowlist', () => {
  it('certified bytes match pinned SHA256 and structure', () => {
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
  });

  it('N01 schedule → BLOCKED', () => {
    expectBlocked(
      classifyWith(
        mutate((s) =>
          s.replace(
            '"on":\n  workflow_dispatch:',
            '"on":\n  schedule:\n    - cron: "0 * * * *"\n  workflow_dispatch:',
          ),
        ),
      ),
    );
  });

  it('N02 bare on:{} empty-run pattern → BLOCKED', () => {
    expectBlocked(classifyWith(mutate((s) => s.replace(/"on":[\s\S]*?inputs:/, 'on: {}\n\n# inputs:'))));
  });

  it('N03 workflow_run → BLOCKED', () => {
    expectBlocked(
      classifyWith(
        mutate((s) =>
          s.replace(
            '"on":\n  workflow_dispatch:',
            '"on":\n  workflow_run:\n    workflows: ["CI"]\n    types: [completed]\n  workflow_dispatch:',
          ),
        ),
      ),
    );
  });

  it('N04 pull_request_target → BLOCKED', () => {
    expectBlocked(
      classifyWith(
        mutate((s) =>
          s.replace(
            '"on":\n  workflow_dispatch:',
            '"on":\n  pull_request_target:\n  workflow_dispatch:',
          ),
        ),
      ),
    );
  });

  it('N05 push → BLOCKED', () => {
    expectBlocked(
      classifyWith(
        mutate((s) =>
          s.replace(
            '"on":\n  workflow_dispatch:',
            '"on":\n  push:\n    branches: [develop]\n  workflow_dispatch:',
          ),
        ),
      ),
    );
  });

  it('N06 pull_request → BLOCKED', () => {
    expectBlocked(
      classifyWith(
        mutate((s) =>
          s.replace(
            '"on":\n  workflow_dispatch:',
            '"on":\n  pull_request:\n  workflow_dispatch:',
          ),
        ),
      ),
    );
  });

  it('N07 repository_dispatch → BLOCKED', () => {
    expectBlocked(
      classifyWith(
        mutate((s) =>
          s.replace(
            '"on":\n  workflow_dispatch:',
            '"on":\n  repository_dispatch:\n  workflow_dispatch:',
          ),
        ),
      ),
    );
  });

  it('N08 issues:write on off job → BLOCKED', () => {
    expectBlocked(
      classifyWith(
        mutate((s) =>
          s.replace(
            'delivery-off:\n    name: Delivery OFF (refuse)\n    if: ${{ inputs.c3_b5_mode != \'C3-B.5-ONESHOT\' || inputs.c3_b5_confirm != \'RUN\' }}\n    runs-on: ubuntu-latest\n    timeout-minutes: 5\n    permissions:\n      contents: read',
            'delivery-off:\n    name: Delivery OFF (refuse)\n    if: ${{ inputs.c3_b5_mode != \'C3-B.5-ONESHOT\' || inputs.c3_b5_confirm != \'RUN\' }}\n    runs-on: ubuntu-latest\n    timeout-minutes: 5\n    permissions:\n      contents: read\n      issues: write',
          ),
        ),
      ),
    );
  });

  it('N09 contents:write top-level → BLOCKED', () => {
    expectBlocked(classifyWith(mutate((s) => s.replace('contents: read\n\nconcurrency:', 'contents: write\n\nconcurrency:'))));
  });

  it('N10 actions:write → BLOCKED', () => {
    expectBlocked(
      classifyWith(mutate((s) => s.replace('contents: read\n\nconcurrency:', 'contents: read\n  actions: write\n\nconcurrency:'))),
    );
  });

  it('N11 secrets → BLOCKED', () => {
    expectBlocked(
      classifyWith(mutate((s) => s.replace('GITHUB_TOKEN: ${{ github.token }}', 'GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}'))),
    );
  });

  it('N12 env token via secrets → BLOCKED', () => {
    expectBlocked(
      classifyWith(mutate((s) => s + '\n# x\nenv:\n  SUPABASE_TOKEN: x\n')),
    );
  });

  it('N13 curl → BLOCKED', () => {
    expectBlocked(classifyWith(mutate((s) => s.replace('npm ci --ignore-scripts', 'curl https://evil.example && npm ci --ignore-scripts'))));
  });

  it('N14-16 gh issue mutations → BLOCKED', () => {
    expectBlocked(classifyWith(mutate((s) => s.replace('supervised-delivery-cli.ts', 'supervised-delivery-cli.ts\n          gh issue create --title x'))));
  });

  it('N17 generic delivery.ts script → BLOCKED', () => {
    expectBlocked(
      classifyWith(
        mutate((s) =>
          s.replace(
            'scripts/syn05-watchdog/supervised-delivery-cli.ts',
            'scripts/syn05-watchdog/delivery.ts',
          ),
        ),
      ),
    );
  });

  it('N18-20 supabase/sql → BLOCKED', () => {
    expectBlocked(classifyWith(mutate((s) => s.replace('npm ci --ignore-scripts', 'supabase db push'))));
  });

  it('N21 reusable workflow → BLOCKED', () => {
    expectBlocked(
      classifyWith(
        mutate((s) =>
          s.replace(
            '- uses: actions/checkout@d23441a48e516b6c34aea4fa41551a30e30af803',
            '- uses: org/repo/.github/workflows/x.yml@main',
          ),
        ),
      ),
    );
  });

  it('N22 unpinned action → BLOCKED', () => {
    expectBlocked(
      classifyWith(
        mutate((s) =>
          s.replace(
            'actions/checkout@d23441a48e516b6c34aea4fa41551a30e30af803',
            'actions/checkout@v4',
          ),
        ),
      ),
    );
  });

  it('N23 external URL via curl already covered; URL in echo → digest mismatch BLOCKED', () => {
    expectBlocked(classifyWith(mutate((s) => s + '\n# https://evil.example\n')));
  });

  it('N25 job-level issues write on wrong job covered by N08', () => {
    expect(true).toBe(true);
  });

  it('N26 rename path → BLOCKED', () => {
    expectBlocked(
      classifyDeployChanges(['.github/workflows/both-stage-watchdog-delivery-renamed.yml'], {
        contentByPath: { '.github/workflows/both-stage-watchdog-delivery-renamed.yml': CERTIFIED },
      }),
    );
  });

  it('N27 other workflow copy → BLOCKED', () => {
    expectBlocked(
      classifyDeployChanges(['.github/workflows/other-watchdog-delivery.yml'], {
        contentByPath: { '.github/workflows/other-watchdog-delivery.yml': CERTIFIED },
      }),
    );
  });

  it('N28 malformed → BLOCKED', () => {
    expectBlocked(classifyWith('"on":\n  workflow_dispatch:\npermissions: [[[\n'));
  });

  it('N29 alias → BLOCKED', () => {
    expectBlocked(classifyWith(mutate((s) => s.replace('"on":', 'x: &t\n  push:\n"on":'))));
  });

  it('N31 content change same name → BLOCKED', () => {
    expectBlocked(classifyWith(mutate((s) => s + '\n# comment\n')));
  });

  it('N32-34 mixed deployable → BLOCKED', () => {
    expectBlocked(classifyWith(CERTIFIED, ['supabase/migrations/20261122000001_x.sql']));
    expectBlocked(classifyWith(CERTIFIED, ['supabase/functions/google-oauth/index.ts']));
    expectBlocked(classifyWith(CERTIFIED, ['.github/workflows/deploy-stage.yml']));
  });

  it('N35 unquoted on boolean coercion → BLOCKED', () => {
    expectBlocked(classifyWith(mutate((s) => s.replace('"on":', 'on:'))));
  });

  it('N36 remove supervised job → BLOCKED', () => {
    expectBlocked(
      classifyWith(mutate((s) => s.replace(/  delivery-supervised:[\s\S]*$/, '\n'))),
    );
  });

  it('N37 remove off job → BLOCKED', () => {
    expectBlocked(
      classifyWith(
        mutate((s) =>
          s.replace(/  delivery-off:[\s\S]*?(?=  delivery-supervised:)/, '  '),
        ),
      ),
    );
  });

  it('N38 functions deploy string → BLOCKED', () => {
    expectBlocked(
      classifyWith(mutate((s) => s.replace('npm ci --ignore-scripts', 'supabase functions deploy'))),
    );
  });

  it('N39 psql → BLOCKED', () => {
    expectBlocked(classifyWith(mutate((s) => s.replace('npm ci --ignore-scripts', 'psql -c "select 1"'))));
  });

  it('N40 gh issue edit → BLOCKED', () => {
    expectBlocked(
      classifyWith(mutate((s) => s.replace('supervised-delivery-cli.ts', 'x\n          gh issue edit 1'))),
    );
  });

  it('N41 gh issue close → BLOCKED', () => {
    expectBlocked(
      classifyWith(mutate((s) => s.replace('supervised-delivery-cli.ts', 'x\n          gh issue close 1'))),
    );
  });

  it('N42 missing content → BLOCKED', () => {
    expectBlocked(
      classifyDeployChanges([INERT_DELIVERY_WORKFLOW_PATH], {
        contentByPath: { [INERT_DELIVERY_WORKFLOW_PATH]: null },
      }),
    );
  });

  it('N43 filename alone without digest → BLOCKED', () => {
    expectBlocked(classifyWith('name: fake\n"on":\n  workflow_dispatch:\n'));
  });

  it('N44 top-level issues write → BLOCKED', () => {
    expectBlocked(
      classifyWith(mutate((s) => s.replace('permissions:\n  contents: read', 'permissions:\n  contents: read\n  issues: write'))),
    );
  });
});
