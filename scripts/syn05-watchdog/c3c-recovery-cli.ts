/**
 * C3-C — Actions CLI for supervised recovery phases.
 * Sanitized JSON only. Never prints tokens.
 */

import { createC3CPorts, runC3CPhase, type C3CPhase } from './c3c-recovery.ts';

function env(name: string): string {
  return process.env[name] ?? '';
}

function parsePhase(raw: string): C3CPhase | null {
  if (raw === 'FIRING' || raw === 'HEALTHY_1' || raw === 'HEALTHY_2') return raw;
  return null;
}

async function main(): Promise<void> {
  const phase = parsePhase(env('C3_C_PHASE'));
  if (!phase) {
    console.log(JSON.stringify({ ok: false, code: 'phase_invalid', phase: env('C3_C_PHASE') }));
    process.exitCode = 2;
    return;
  }
  if (env('C3_C_CONFIRM') !== 'RUN') {
    console.log(JSON.stringify({ ok: false, code: 'confirm_required', phase }));
    process.exitCode = 2;
    return;
  }

  const actions = {
    event_name: env('C3_C_EVENT_NAME') || env('GITHUB_EVENT_NAME'),
    workflow_name: env('C3_C_ACTIONS_WORKFLOW') || env('GITHUB_WORKFLOW'),
    job_name: env('C3_C_ACTIONS_JOB') || env('GITHUB_JOB'),
    ref: env('C3_C_REF') || env('GITHUB_REF'),
    run_id: env('C3_C_ACTIONS_RUN_ID') || env('GITHUB_RUN_ID'),
    commit_sha: env('C3_C_EXPECTED_COMMIT') || env('GITHUB_SHA'),
  };

  const token = env('GITHUB_TOKEN');
  if (!token) {
    console.log(JSON.stringify({ ok: false, code: 'token_absent', phase }));
    process.exitCode = 2;
    return;
  }

  const authIssueRaw = env('C3_C_AUTHORIZED_ISSUE');
  const authorized_issue_number = authIssueRaw ? Number(authIssueRaw) : undefined;
  if (authIssueRaw && !Number.isFinite(authorized_issue_number)) {
    console.log(JSON.stringify({ ok: false, code: 'authorized_issue_invalid', phase }));
    process.exitCode = 2;
    return;
  }

  const ports = createC3CPorts(token);
  const result = await runC3CPhase({
    phase,
    ports,
    actions,
    authorized_issue_number,
  });

  console.log(
    JSON.stringify({
      ok: result.ok,
      code: result.code,
      phase: result.phase,
      issue_number: result.issue_number ?? null,
      issue_url: result.issue_url ?? null,
      issue_state: result.issue_state ?? null,
      consecutive_healthy: result.consecutive_healthy ?? null,
      fingerprint: result.fingerprint,
      sample_window_end: result.sample_window_end,
      run_id: result.run_id,
      post_attempts: result.post_attempts ?? 0,
      patch_attempts: result.patch_attempts ?? 0,
    }),
  );
  process.exitCode = result.ok ? 0 : 2;
}

const isMain =
  !!process.argv[1] &&
  (process.argv[1].endsWith('/c3c-recovery-cli.ts') ||
    process.argv[1].endsWith('\\c3c-recovery-cli.ts'));

if (isMain) {
  main().catch((err) => {
    const detail = err instanceof Error ? err.message.slice(0, 80) : 'cli_crash';
    console.log(JSON.stringify({ ok: false, code: 'cli_error', detail }));
    process.exitCode = 2;
  });
}
