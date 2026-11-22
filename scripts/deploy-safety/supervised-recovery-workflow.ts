/**
 * SYN-05 C3-C — certified supervised recovery workflow allowlist.
 * Exact path + digest pin + structure. issues:write only on delivery-supervised-recovery.
 */

import { createHash } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

export const SUPERVISED_RECOVERY_WORKFLOW_PATH =
  '.github/workflows/both-stage-watchdog-recovery.yml' as const;

/** C3-C supervised recovery essay workflow (digest pin). */
export const SUPERVISED_RECOVERY_WORKFLOW_SHA256 =
  '5b9b636c7b695f2adc7b31982baec8e0f2b3a1d0fc298b3cc77db379bd46a8f0' as const;

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
  if (!/delivery-supervised-recovery:/.test(stripped)) {
    reasons.push('supervised_recovery_missing_supervised_job');
  }
  if (!/recovery-off:/.test(stripped)) {
    reasons.push('supervised_recovery_missing_off_job');
  }

  // Top-level permissions must be contents:read only (no global issues:write)
  const topPerm = content.match(/^permissions:\s*\n((?:[ \t]+.+\n)*)/m);
  if (!topPerm || !/contents:\s*read/.test(topPerm[1]) || /issues\s*:\s*write/i.test(topPerm[1])) {
    reasons.push('supervised_recovery_toplevel_permissions');
  }

  // issues:write allowed only under delivery-supervised-recovery job block
  const issuesWriteMatches = [...stripped.matchAll(/issues\s*:\s*write/gi)];
  if (issuesWriteMatches.length !== 1) {
    reasons.push('supervised_recovery_issues_write_count');
  }
  const supervisedIdx = stripped.indexOf('delivery-supervised-recovery:');
  const issuesIdx = stripped.search(/issues\s*:\s*write/i);
  if (supervisedIdx < 0 || issuesIdx < 0 || issuesIdx < supervisedIdx) {
    reasons.push('supervised_recovery_issues_write_wrong_job');
  }

  if (!/c3c-recovery-cli\.ts/.test(stripped)) {
    reasons.push('supervised_recovery_cli_missing');
  }
  if (/supervised-delivery-cli\.ts/.test(stripped)) {
    reasons.push('supervised_recovery_banned_delivery_cli');
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
  if (/cron\s*:/i.test(stripped)) reasons.push('supervised_recovery_trigger_schedule');
  if (!/cancel-in-progress:\s*false/.test(stripped)) {
    reasons.push('supervised_recovery_cancel_in_progress_must_be_false');
  }
  if (!/BOTH_WATCHDOG_C3_C_AUTHORIZED:\s*"1"/.test(stripped)) {
    reasons.push('supervised_recovery_c3c_auth_flag_missing');
  }
  // Pin known action SHAs
  if (!/actions\/checkout@d23441a48e516b6c34aea4fa41551a30e30af803/.test(stripped)) {
    reasons.push('supervised_recovery_checkout_pin');
  }
  if (!/actions\/setup-node@949feb2413d6458794dcd2491c4babbbce0c15c1/.test(stripped)) {
    reasons.push('supervised_recovery_setup_node_pin');
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
