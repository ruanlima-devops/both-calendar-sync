/**
 * SYN-05 C3-B.5 — certified Delivery workflow allowlist (FINAL OFF).
 * Exact path + digest pin + structure. No issues:write. No oneshot.
 */

import { createHash } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

export const INERT_DELIVERY_WORKFLOW_PATH =
  '.github/workflows/both-stage-watchdog-delivery.yml' as const;

/** C3-B.5 final OFF workflow (post-disablement). */
export const INERT_DELIVERY_WORKFLOW_SHA256 =
  '0f721249b40da48558801642529810fdbc528f466c311cd76812a520862e9c26' as const;

export type InertWorkflowValidation = {
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

export function validateInertDeliveryWorkflowContent(content: string): InertWorkflowValidation {
  const reasons: string[] = [];
  const sha = sha256Hex(content);
  const digest_ok = sha === INERT_DELIVERY_WORKFLOW_SHA256;
  if (!digest_ok) reasons.push('inert_delivery_digest_mismatch');

  if (!content.trim()) {
    return {
      ok: false,
      reasons: [...reasons, 'inert_delivery_empty'],
      sha256: sha,
      path_ok: true,
      digest_ok,
      structure_ok: false,
    };
  }
  if (content.includes('\0')) reasons.push('inert_delivery_binary_null');

  const stripped = stripYamlComments(content);

  if (/^on:\s*\{\s*\}\s*$/m.test(stripped) && !/^"on":\s*$/m.test(stripped)) {
    reasons.push('inert_delivery_unquoted_on_empty');
  }

  const onBlock = extractOnBlock(stripped);
  if (!onBlock.found) reasons.push('inert_delivery_on_missing');
  else {
    if (onBlock.rawKey !== '"on"') reasons.push('inert_delivery_on_must_be_quoted');
    if (onBlock.body.trim() === '{}') reasons.push('inert_delivery_on_empty_map_forbidden');
    for (const key of ['schedule', 'workflow_run', 'pull_request_target', 'push', 'pull_request', 'repository_dispatch', 'workflow_call']) {
      if (new RegExp(`^\\s+${key}\\s*:`, 'm').test(onBlock.body)) {
        reasons.push(`inert_delivery_trigger_${key}`);
      }
    }
    if (!/^\s+workflow_dispatch\s*:/m.test(onBlock.body)) {
      reasons.push('inert_delivery_workflow_dispatch_required');
    }
    const triggerKeys = [...onBlock.body.matchAll(/^\s{2}([A-Za-z0-9_]+)\s*:/gm)].map((m) => m[1]);
    for (const k of triggerKeys) {
      if (k !== 'workflow_dispatch') reasons.push(`inert_delivery_trigger_${k}`);
    }
  }

  if (!/permissions:\s*\n\s*contents:\s*read\b/.test(content)) {
    reasons.push('inert_delivery_contents_read_missing');
  }
  if (/issues\s*:\s*write/i.test(stripped)) {
    reasons.push('inert_delivery_issues_write');
  }
  if (/:\s*write\b/i.test(stripped)) {
    reasons.push('inert_delivery_permission_write');
  }
  if (!/delivery-off:/.test(stripped)) {
    reasons.push('inert_delivery_missing_off_job');
  }
  if (/delivery-supervised:/.test(stripped)) {
    reasons.push('inert_delivery_supervised_job_must_be_removed');
  }
  if (/C3-B\.5-ONESHOT/.test(content)) {
    reasons.push('inert_delivery_oneshot_must_be_removed');
  }
  if (/BOTH_WATCHDOG_GITHUB_WRITE:\s*["']?1/.test(stripped)) {
    reasons.push('inert_delivery_write_flag_enabled');
  }
  if (/\$\{\{\s*secrets\./i.test(stripped) || /^\s*secrets\s*:/m.test(stripped)) {
    reasons.push('inert_delivery_banned_secrets');
  }
  if (/SUPABASE_|supabase\s+db\s+push|supabase\s+functions\s+deploy/i.test(stripped)) {
    reasons.push('inert_delivery_banned_supabase');
  }
  if (/\bcurl\b/i.test(stripped)) reasons.push('inert_delivery_banned_curl');
  if (/\bgh\s+issue\s+(create|edit|close)\b/i.test(stripped)) {
    reasons.push('inert_delivery_banned_gh_issue');
  }
  if (/(^|\s)[&*][A-Za-z0-9_-]+/m.test(stripped)) {
    reasons.push('inert_delivery_banned_anchor_or_alias');
  }
  if (/^\s+-\s+uses:\s+/m.test(stripped)) {
    reasons.push('inert_delivery_banned_uses_action');
  }
  if (/supervised-delivery-cli\.ts|syn05-watchdog\/delivery\.ts/.test(stripped)) {
    reasons.push('inert_delivery_banned_delivery_script');
  }
  if (/cron\s*:/i.test(stripped)) reasons.push('inert_delivery_trigger_schedule');

  const structure_ok = !reasons.some(
    (r) => r !== 'inert_delivery_digest_mismatch' && r.startsWith('inert_delivery_'),
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

export function readAndValidateInertDeliveryWorkflow(
  repoRoot: string,
  relPath: string = INERT_DELIVERY_WORKFLOW_PATH,
): InertWorkflowValidation {
  if (relPath !== INERT_DELIVERY_WORKFLOW_PATH) {
    return {
      ok: false,
      reasons: ['inert_delivery_path_mismatch'],
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
      reasons: ['inert_delivery_file_missing'],
      sha256: '',
      path_ok: true,
      digest_ok: false,
      structure_ok: false,
    };
  }
  return validateInertDeliveryWorkflowContent(readFileSync(abs, 'utf8'));
}
