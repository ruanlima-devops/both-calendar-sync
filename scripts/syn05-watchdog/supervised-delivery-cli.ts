/**
 * C3-B.5 — Actions entrypoint for supervised oneshot Issue create.
 * Sanitized JSON summary only. Never prints tokens or raw HTTP bodies.
 */

import {
  assertActionsBinding,
  createLiveSupervisedPorts,
  runSupervisedOneshot,
} from './supervised-delivery.ts';

function env(name: string): string {
  return process.env[name] ?? '';
}

async function main(): Promise<void> {
  const actions = {
    event_name: env('C3_B5_EVENT_NAME') || env('GITHUB_EVENT_NAME'),
    workflow_name: env('C3_B5_ACTIONS_WORKFLOW') || env('GITHUB_WORKFLOW'),
    job_name: env('C3_B5_ACTIONS_JOB') || env('GITHUB_JOB'),
    ref: env('C3_B5_REF') || env('GITHUB_REF'),
    run_id: env('C3_B5_ACTIONS_RUN_ID') || env('GITHUB_RUN_ID'),
    commit_sha: env('C3_B5_EXPECTED_COMMIT') || env('GITHUB_SHA'),
  };

  const bindErr = assertActionsBinding(actions);
  if (bindErr) {
    console.log(JSON.stringify({ ok: false, code: bindErr, post_attempts: 0 }));
    process.exitCode = 2;
    return;
  }

  const token = env('GITHUB_TOKEN');
  if (!token) {
    console.log(JSON.stringify({ ok: false, code: 'token_absent', post_attempts: 0 }));
    process.exitCode = 2;
    return;
  }

  const ports = createLiveSupervisedPorts(token);
  const result = await runSupervisedOneshot({
    search: ports.search,
    create: ports.create,
    env: {
      BOTH_WATCHDOG_DRY_RUN: env('BOTH_WATCHDOG_DRY_RUN') || '0',
      BOTH_WATCHDOG_GITHUB_WRITE: env('BOTH_WATCHDOG_GITHUB_WRITE') || '1',
      BOTH_WATCHDOG_ENABLE_NETWORK: env('BOTH_WATCHDOG_ENABLE_NETWORK') || '1',
      BOTH_WATCHDOG_DELIVERY_MODE: env('BOTH_WATCHDOG_DELIVERY_MODE') || 'supervised-write',
      BOTH_WATCHDOG_C3_B5_AUTHORIZED: env('BOTH_WATCHDOG_C3_B5_AUTHORIZED') || '1',
      BOTH_WATCHDOG_C3_B41_FORCE_BLOCK: env('BOTH_WATCHDOG_C3_B41_FORCE_BLOCK') || '0',
      GITHUB_REPOSITORY: env('GITHUB_REPOSITORY') || 'ruanlima-devops/both-calendar-sync',
    },
    provenance: {
      expected_run_id: actions.run_id,
      expected_commit_sha: actions.commit_sha,
    },
    actions,
    permission_issues_write_available: true,
    token_present: true,
  });

  // Sanitized evidence only
  console.log(
    JSON.stringify({
      ok: result.ok,
      code: result.code,
      http_status: result.http_status ?? null,
      issue_number: result.issue_number ?? null,
      issue_url: result.issue_url ?? null,
      post_attempts: result.post_attempts,
      fingerprint: result.fingerprint ?? null,
      artifact_sha256: result.artifact_sha256 ?? null,
      quota_code: result.quota.code,
      remaining_creates: result.quota.remaining_creates,
    }),
  );
  process.exitCode = result.ok ? 0 : 2;
}

const isMain =
  !!process.argv[1] &&
  (process.argv[1].endsWith('/supervised-delivery-cli.ts') ||
    process.argv[1].endsWith('\\supervised-delivery-cli.ts'));

if (isMain) {
  main().catch((err) => {
    const code = err instanceof Error ? err.message.slice(0, 80) : 'cli_crash';
    console.log(JSON.stringify({ ok: false, code: 'cli_error', detail: code, post_attempts: 0 }));
    process.exitCode = 2;
  });
}
