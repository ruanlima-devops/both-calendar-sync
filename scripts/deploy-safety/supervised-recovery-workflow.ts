/**
 * SYN-05 C3-C — certified recovery workflow allowlist (FINAL OFF).
 * Exact path + digest pin + structure. No issues:write. No supervised job.
 */

import { createHash } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

export const SUPERVISED_RECOVERY_WORKFLOW_PATH =
  '.github/workflows/both-stage-watchdog-recovery.yml' as const;

/** C3-C final OFF recovery workflow (post-essay disablement). */
export const SUPERVISED_RECOVERY_WORKFLOW_SHA256 =
  'be6bb93b77f095636ec5c5676ca8c000cab9844f2704fa6f4fe08a115b846690' as const;

export type SupervisedRecoveryValidation = {
  ok: boolean;
  reasons: string[];
  sha256: string;
  path_ok: boolean;
  digest_ok: boolean;
  structure_ok: boolean;
};

export function sha256Hex(content: string | Buffer): string {
  return createHash('sha256').update(content).digest('hex');
}

function stripYamlComments(text: string): string {
  return text
    .split(/\r?\n/)
    .map((line) => {
      let out = '';
      let quote: '"' | "'" | null = null;
      for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (quote) {
          out += ch;
          if (ch === quote && line[i - 1] !== '\\') quote = null;
          continue;
        }
        if (ch === '"' || ch === "'") {
          quote = ch;
          out += ch;
          continue;
        }
        if (ch === '#') break;
        out += ch;
      }
      return out;
    })
    .join('\n');
}

function extractOnBlock(stripped: string): { found: boolean; body: string; rawKey: string } {
  const lines = stripped.split(/\n/);
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^("on"|on|true)\s*:\s*(.*)$/);
    if (!m) continue;
    const inline = m[2].trim();
    if (inline === '{}') return { found: true, body: '{}', rawKey: m[1] };
    if (inline === '') {
      const bodyLines: string[] = [];
      for (let j = i + 1; j < lines.length; j++) {
        const l = lines[j];
        if (/^("on"|on|true|[A-Za-z_])/.test(l) && !/^\s/.test(l)) break;
        if (l.trim() === '') continue;
        bodyLines.push(l);
      }
      return { found: true, body: bodyLines.join('\n'), rawKey: m[1] };
    }
    return { found: true, body: inline, rawKey: m[1] };
  }
  return { found: false, body: '', rawKey: '' };
}

export function validateSupervisedRecoveryWorkflowContent(content: string): SupervisedRecoveryValidation {
  const reasons: string[] = [];
  const sha = sha256Hex(content);
  const digest_ok = sha === SUPERVISED_RECOVERY_WORKFLOW_SHA256;
  if (!digest_ok) reasons.push('supervised_recovery_digest_mismatch');

  if (!content.trim()) {
    return {
      ok: false,
      reasons: [...reasons, 'supervised_recovery_empty'],
      sha256: sha,
      path_ok: true,
      digest_ok,
      structure_ok: false,
    };
  }
  if (content.includes('\0')) reasons.push('supervised_recovery_binary_null');

  const stripped = stripYamlComments(content);

  const onBlock = extractOnBlock(stripped);
  if (!onBlock.found) reasons.push('supervised_recovery_on_missing');
  else {
    if (onBlock.rawKey !== '"on"') reasons.push('supervised_recovery_on_must_be_quoted');
    if (onBlock.body.trim() === '{}') reasons.push('supervised_recovery_on_empty_map_forbidden');
    for (const key of [
      'schedule',
      'workflow_run',
      'pull_request_target',
      'push',
      'pull_request',
      'repository_dispatch',
      'workflow_call',
    ]) {
      if (new RegExp(`^\\s+${key}\\s*:`, 'm').test(onBlock.body)) {
        reasons.push(`supervised_recovery_trigger_${key}`);
      }
    }
    if (!/^\s+workflow_dispatch\s*:/m.test(onBlock.body)) {
      reasons.push('supervised_recovery_workflow_dispatch_required');
    }
    const triggerKeys = [...onBlock.body.matchAll(/^\s{2}([A-Za-z0-9_]+)\s*:/gm)].map((m) => m[1]);
    for (const k of triggerKeys) {
      if (k !== 'workflow_dispatch') reasons.push(`supervised_recovery_trigger_${k}`);
    }
  }

  if (!/^name:\s*Both STAGE Watchdog Recovery\s*$/m.test(content)) {
    reasons.push('supervised_recovery_name_mismatch');
  }
  if (!/recovery-off:/.test(stripped)) {
    reasons.push('supervised_recovery_missing_off_job');
  }
  if (/delivery-supervised-recovery:/.test(stripped)) {
    reasons.push('supervised_recovery_supervised_job_must_be_removed');
  }
  if (!/permissions:\s*\n\s*contents:\s*read\b/.test(content)) {
    reasons.push('supervised_recovery_contents_read_missing');
  }
  if (/issues\s*:\s*write/i.test(stripped)) {
    reasons.push('supervised_recovery_issues_write');
  }
  if (/:\s*write\b/i.test(stripped)) {
    reasons.push('supervised_recovery_permission_write');
  }
  if (/BOTH_WATCHDOG_GITHUB_WRITE:\s*["']?1/.test(stripped)) {
    reasons.push('supervised_recovery_write_flag_enabled');
  }
  if (/BOTH_WATCHDOG_C3_C_AUTHORIZED:\s*["']?1/.test(stripped)) {
    reasons.push('supervised_recovery_c3c_auth_enabled');
  }
  if (/c3c-recovery-cli\.ts/.test(stripped)) {
    reasons.push('supervised_recovery_cli_must_be_removed');
  }
  if (/\$\{\{\s*secrets\./i.test(stripped) || /^\s*secrets\s*:/m.test(stripped)) {
    reasons.push('supervised_recovery_banned_secrets');
  }
  if (/SUPABASE_|supabase\s+db\s+push|supabase\s+functions\s+deploy/i.test(stripped)) {
    reasons.push('supervised_recovery_banned_supabase');
  }
  if (/\bcurl\b/i.test(stripped)) reasons.push('supervised_recovery_banned_curl');
  if (/\bgh\s+issue\s+(create|edit|close)\b/i.test(stripped)) {
    reasons.push('supervised_recovery_banned_gh_issue');
  }
  if (/(^|\s)[&*][A-Za-z0-9_-]+/m.test(stripped)) {
    reasons.push('supervised_recovery_banned_anchor_or_alias');
  }
  if (/^\s+-\s+uses:\s+/m.test(stripped)) {
    reasons.push('supervised_recovery_banned_uses_action');
  }
  if (/cron\s*:/i.test(stripped)) reasons.push('supervised_recovery_trigger_schedule');
  if (!/cancel-in-progress:\s*false/.test(stripped)) {
    reasons.push('supervised_recovery_cancel_in_progress_must_be_false');
  }

  const structure_ok = !reasons.some(
    (r) => r !== 'supervised_recovery_digest_mismatch' && r.startsWith('supervised_recovery_'),
  );

  return {
    ok: digest_ok && structure_ok,
    reasons: [...new Set(reasons)],
    sha256: sha,
    path_ok: true,
    digest_ok,
    structure_ok,
  };
}

export function readAndValidateSupervisedRecoveryWorkflow(
  repoRoot: string,
  relPath: string = SUPERVISED_RECOVERY_WORKFLOW_PATH,
): SupervisedRecoveryValidation {
  if (relPath !== SUPERVISED_RECOVERY_WORKFLOW_PATH) {
    return {
      ok: false,
      reasons: ['supervised_recovery_path_mismatch'],
      sha256: '',
      path_ok: false,
      digest_ok: false,
      structure_ok: false,
    };
  }
  const abs = join(repoRoot, relPath);
  if (!existsSync(abs)) {
    return {
      ok: false,
      reasons: ['supervised_recovery_file_missing'],
      sha256: '',
      path_ok: true,
      digest_ok: false,
      structure_ok: false,
    };
  }
  return validateSupervisedRecoveryWorkflowContent(readFileSync(abs, 'utf8'));
}
