/**
 * SYN-05 C3-B.4 — allowlist gate for the inert Delivery workflow only.
 *
 * Fail-closed: exact path + exact certified digest + structural inertness.
 * Filename alone never authorizes SAFE_SKIP. Future YAML edits must change the
 * pinned digest in a deliberate review (and still pass structural checks).
 */

import { createHash } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

export const INERT_DELIVERY_WORKFLOW_PATH =
  '.github/workflows/both-stage-watchdog-delivery.yml' as const;

/** Certified C3-B.4.1 disabled scaffold (on: {}). */
export const INERT_DELIVERY_WORKFLOW_SHA256 =
  '9bf332340ac158eb3a80edb317e3a2adbc358843540ae5c144a700175820a44d' as const;

const BANNED_TRIGGER_KEYS = [
  'schedule',
  'workflow_dispatch',
  'workflow_run',
  'pull_request_target',
  'push',
  'pull_request',
  'repository_dispatch',
  'release',
  'create',
  'delete',
  'issue_comment',
  'issues',
  'discussion',
  'check_run',
  'check_suite',
  'deployment',
  'deployment_status',
  'page_build',
  'status',
  'watch',
  'workflow_call',
] as const;

const BANNED_PERMISSION_WRITES = [
  'issues: write',
  'issues:write',
  'contents: write',
  'contents:write',
  'actions: write',
  'actions:write',
  'pull-requests: write',
  'pull-requests:write',
  'workflows: write',
  'workflows:write',
] as const;

const BANNED_CONTENT_PATTERNS: { id: string; re: RegExp }[] = [
  { id: 'secrets_context', re: /\$\{\{\s*secrets\./i },
  { id: 'secrets_key', re: /^\s*secrets\s*:/m },
  { id: 'env_token', re: /^\s*[A-Z0-9_]*(TOKEN|PASSWORD|SECRET|SUPABASE)[A-Z0-9_]*\s*:/m },
  { id: 'curl', re: /\bcurl\b/i },
  { id: 'gh_issue_create', re: /\bgh\s+issue\s+create\b/i },
  { id: 'gh_issue_edit', re: /\bgh\s+issue\s+edit\b/i },
  { id: 'gh_issue_close', re: /\bgh\s+issue\s+close\b/i },
  { id: 'delivery_script', re: /syn05-watchdog\/delivery\.ts|\bdelivery\.ts\b/i },
  { id: 'supabase_db_push', re: /supabase\s+db\s+push/i },
  { id: 'supabase_functions_deploy', re: /supabase\s+functions\s+deploy/i },
  { id: 'sql_exec', re: /\bpsql\b|\bmysql\b|supabase\s+db\s+execute/i },
  { id: 'reusable_workflow', re: /^\s+uses:\s*.*\.ya?ml/m },
  { id: 'uses_action', re: /^\s+-\s+uses:\s+/m },
  { id: 'external_url', re: /https?:\/\//i },
  { id: 'dynamic_steps', re: /\$\{\{\s*toJSON\(|fromJSON\(|steps\.[^}]+\.outputs/i },
  { id: 'anchor_or_alias', re: /(^|\s)[&*][A-Za-z0-9_-]+/m },
];

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
      const inSingle = false;
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
      void inSingle;
      return out;
    })
    .join('\n');
}

/** Extract top-level `on` / boolean-true mapping body (YAML 1.1 may treat `on` as true). */
function extractOnBlock(stripped: string): { found: boolean; body: string; rawKey: string } {
  const lines = stripped.split(/\n/);
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^(on|true)\s*:\s*(.*)$/);
    if (!m) continue;
    const inline = m[2].trim();
    if (inline === '{}') return { found: true, body: '{}', rawKey: m[1] };
    if (inline === '') {
      const bodyLines: string[] = [];
      for (let j = i + 1; j < lines.length; j++) {
        const l = lines[j];
        if (/^[A-Za-z_]/.test(l) || l.startsWith('on:') || l.startsWith('true:')) break;
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

  // Reject tab-indent / null bytes / obvious non-YAML
  if (content.includes('\0')) reasons.push('inert_delivery_binary_null');

  const stripped = stripYamlComments(content);

  for (const { id, re } of BANNED_CONTENT_PATTERNS) {
    if (re.test(stripped)) reasons.push(`inert_delivery_banned_${id}`);
  }

  for (const perm of BANNED_PERMISSION_WRITES) {
    if (stripped.toLowerCase().includes(perm.replace(/\s+/g, ' ')) || stripped.toLowerCase().includes(perm.replace(/\s+/g, ''))) {
      reasons.push(`inert_delivery_banned_perm_${perm.replace(/[^a-z]/g, '_')}`);
    }
  }
  // job-level permissions write
  if (/^\s+permissions\s*:/m.test(stripped) && /write/i.test(stripped)) {
    // top-level contents:read is ok; any write is not
    if (/:\s*write\b/i.test(stripped)) reasons.push('inert_delivery_permission_write');
  }

  const onBlock = extractOnBlock(stripped);
  if (!onBlock.found) {
    reasons.push('inert_delivery_on_missing');
  } else if (onBlock.body.trim() !== '{}') {
    reasons.push('inert_delivery_on_not_empty');
    for (const key of BANNED_TRIGGER_KEYS) {
      const keyRe = new RegExp(`^\\s+${key}\\s*:`, 'm');
      if (keyRe.test(onBlock.body) || new RegExp(`\\b${key}\\s*:`, 'm').test(onBlock.body)) {
        reasons.push(`inert_delivery_trigger_${key}`);
      }
    }
    // also scan full stripped for trigger keys nested under on equivalents
    for (const key of BANNED_TRIGGER_KEYS) {
      if (new RegExp(`^\\s+${key}\\s*:`, 'm').test(stripped) && onBlock.body.includes(key)) {
        reasons.push(`inert_delivery_trigger_${key}`);
      }
    }
  }

  // Require disabled job guard in certified shape
  if (!/if:\s*\$\{\{\s*false\s*\}\}/.test(stripped) && !/if:\s*false\b/.test(stripped)) {
    reasons.push('inert_delivery_missing_false_guard');
  }

  // Must declare contents: read and must not grant issues
  if (!/permissions:\s*\n\s*contents:\s*read\b/.test(content) && !/contents:\s*read\b/.test(stripped)) {
    reasons.push('inert_delivery_contents_read_missing');
  }
  if (/issues\s*:\s*write/i.test(stripped)) {
    reasons.push('inert_delivery_issues_write');
  }

  // Malformed: unclosed quotes / odd document start
  if (/^\s*---\s*$/m.test(stripped) && stripped.split(/^---\s*$/m).length > 3) {
    reasons.push('inert_delivery_multi_doc');
  }

  // Structure independently of digest for reporting; ok requires both.
  const structure_ok = !reasons.some(
    (r) => r !== 'inert_delivery_digest_mismatch' && r.startsWith('inert_delivery_'),
  );

  const uniqueReasons = [...new Set(reasons)];
  return {
    ok: digest_ok && structure_ok,
    reasons: uniqueReasons,
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
  const content = readFileSync(abs, 'utf8');
  return validateInertDeliveryWorkflowContent(content);
}
