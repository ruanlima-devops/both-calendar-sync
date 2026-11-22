/**
 * SYN-05 C3-B.5 — certified Delivery workflow allowlist gate.
 *
 * Fail-closed: exact path + exact certified digest + structural rules.
 * Filename alone never authorizes SAFE_SKIP.
 *
 * C3-B.5 shape (empty-run fix):
 * - Quoted "on" with workflow_dispatch only (no bare on:{}).
 * - No schedule/push/pull_request/workflow_run.
 * - Top-level contents:read only.
 * - issues:write only under job delivery-supervised.
 * - Pinned actions/checkout + setup-node SHAs only.
 */

import { createHash } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

export const INERT_DELIVERY_WORKFLOW_PATH =
  '.github/workflows/both-stage-watchdog-delivery.yml' as const;

/** C3-B.5 certified workflow bytes (workflow_dispatch OFF-by-default + oneshot job). */
export const INERT_DELIVERY_WORKFLOW_SHA256 =
  '63e3fad10e83da89c7d1a3e3511b0168ba17ebd8defeda72514fe37b5afb921a' as const;

/** @deprecated alias kept for callers */
export const CERTIFIED_DELIVERY_WORKFLOW_SHA256 = INERT_DELIVERY_WORKFLOW_SHA256;

const ALLOWED_ACTION_USES = [
  'actions/checkout@d23441a48e516b6c34aea4fa41551a30e30af803',
  'actions/setup-node@949feb2413d6458794dcd2491c4babbbce0c15c1',
] as const;

const BANNED_TRIGGER_KEYS = [
  'schedule',
  'workflow_run',
  'pull_request_target',
  'push',
  'pull_request',
  'repository_dispatch',
  'release',
  'workflow_call',
] as const;

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

function jobSection(stripped: string, jobId: string): string {
  const lines = stripped.split('\n');
  const start = lines.findIndex((l) => new RegExp(`^\\s{2}${jobId}:\\s*$`).test(l));
  if (start < 0) return '';
  const out: string[] = [];
  for (let i = start + 1; i < lines.length; i++) {
    const l = lines[i];
    if (/^\s{2}[A-Za-z0-9_-]+:\s*$/.test(l) && !/^\s{4}/.test(l)) break;
    if (/^[A-Za-z"]/.test(l)) break;
    out.push(l);
  }
  return out.join('\n');
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

  // Must use quoted "on" (empty-run fix) — reject bare on:{}
  if (/^on:\s*\{\s*\}\s*$/m.test(stripped) || /^on:\s*$/m.test(stripped)) {
    if (!/^"on":\s*$/m.test(stripped)) {
      reasons.push('inert_delivery_unquoted_on_empty');
    }
  }

  const onBlock = extractOnBlock(stripped);
  if (!onBlock.found) {
    reasons.push('inert_delivery_on_missing');
  } else {
    if (onBlock.rawKey !== '"on"' && onBlock.rawKey !== 'on') {
      // YAML 1.1 true key is unsafe
      if (onBlock.rawKey === 'true') reasons.push('inert_delivery_on_boolean_coerced');
    }
    if (onBlock.rawKey !== '"on"') {
      reasons.push('inert_delivery_on_must_be_quoted');
    }
    if (onBlock.body.trim() === '{}') {
      reasons.push('inert_delivery_on_empty_map_forbidden');
    }
    for (const key of BANNED_TRIGGER_KEYS) {
      if (new RegExp(`^\\s+${key}\\s*:`, 'm').test(onBlock.body)) {
        reasons.push(`inert_delivery_trigger_${key}`);
      }
    }
    if (!/^\s+workflow_dispatch\s*:/m.test(onBlock.body)) {
      reasons.push('inert_delivery_workflow_dispatch_required');
    }
    // Only workflow_dispatch allowed under on
    const triggerKeys = [...onBlock.body.matchAll(/^\s{2}([A-Za-z0-9_]+)\s*:/gm)].map((m) => m[1]);
    for (const k of triggerKeys) {
      if (k !== 'workflow_dispatch') reasons.push(`inert_delivery_trigger_${k}`);
    }
  }

  // Top-level permissions: contents read; no top-level issues write
  if (!/permissions:\s*\n\s*contents:\s*read\b/.test(content)) {
    reasons.push('inert_delivery_contents_read_missing');
  }

  // Split jobs
  const supervised = jobSection(stripped, 'delivery-supervised');
  const offJob = jobSection(stripped, 'delivery-off');
  if (!offJob) reasons.push('inert_delivery_missing_off_job');
  if (!supervised) reasons.push('inert_delivery_missing_supervised_job');

  // issues:write only inside delivery-supervised
  const issuesWriteMatches = [...stripped.matchAll(/issues\s*:\s*write/gi)];
  for (const m of issuesWriteMatches) {
    const idx = m.index ?? 0;
    const before = stripped.slice(0, idx);
    const lastJob = [...before.matchAll(/^\s{2}(delivery-[a-z0-9-]+):/gm)].pop();
    if (!lastJob || lastJob[1] !== 'delivery-supervised') {
      reasons.push('inert_delivery_issues_write_outside_supervised');
    }
  }

  // Banned top-level / global writes
  if (/^\s{2}contents:\s*write/m.test(stripped) || /^\s{2}actions:\s*write/m.test(stripped)) {
    reasons.push('inert_delivery_permission_write');
  }

  // Secrets / supabase / deploy / curl / gh issue
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

  // uses: only pinned allowlist
  const uses = [...stripped.matchAll(/^\s+-\s+uses:\s+(\S+)/gm)].map((m) => m[1]);
  for (const u of uses) {
    if (!(ALLOWED_ACTION_USES as readonly string[]).includes(u)) {
      reasons.push(`inert_delivery_banned_uses_${u.slice(0, 40)}`);
    }
  }
  if (/^\s+uses:\s*.*\.ya?ml/m.test(stripped)) {
    reasons.push('inert_delivery_banned_reusable_workflow');
  }

  // CLI must be the supervised oneshot entry, not generic delivery.ts as a shell script side channel
  if (/syn05-watchdog\/delivery\.ts\b/.test(stripped) && !/supervised-delivery-cli\.ts/.test(stripped)) {
    reasons.push('inert_delivery_banned_delivery_script');
  }
  if (supervised && !/supervised-delivery-cli\.ts/.test(supervised)) {
    reasons.push('inert_delivery_supervised_cli_missing');
  }

  // Inputs required
  if (!/c3_b5_mode/.test(stripped) || !/c3_b5_confirm/.test(stripped)) {
    reasons.push('inert_delivery_missing_oneshot_inputs');
  }
  if (!/C3-B\.5-ONESHOT/.test(content)) {
    reasons.push('inert_delivery_missing_oneshot_token');
  }

  // No schedule strings
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
