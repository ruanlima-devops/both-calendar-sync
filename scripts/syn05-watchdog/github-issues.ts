/**
 * GitHub Issues adapter — interface + in-memory fake.
 * Real write path is gated behind BOTH_WATCHDOG_GITHUB_WRITE=1 (never set in this phase).
 */

import { redactText } from './redact.ts';
import {
  BOT_FINGERPRINT_PREFIX,
  BOT_LABEL,
  BOT_MARKER,
  type AlertEvaluation,
  type IncidentRecord,
} from './types.ts';

export type IssueSearchQuery = {
  label: string;
  state?: 'open' | 'closed' | 'all';
};

export interface GithubIssuesPort {
  listBotIncidents(state?: 'open' | 'closed' | 'all'): Promise<IncidentRecord[]>;
  createIncident(evaluation: AlertEvaluation): Promise<IncidentRecord>;
  updateIncident(incident: IncidentRecord, evaluation: AlertEvaluation): Promise<IncidentRecord>;
  closeIncident(incident: IncidentRecord, evaluation: AlertEvaluation): Promise<IncidentRecord>;
}

/** Env bag for flag checks — avoids requiring full NodeJS.ProcessEnv in unit tests. */
export type WatchdogEnv = Record<string, string | undefined>;

export function isGithubWriteEnabled(env: WatchdogEnv = process.env): boolean {
  return env.BOTH_WATCHDOG_GITHUB_WRITE === '1' && env.BOTH_WATCHDOG_DRY_RUN !== '1';
}

export function buildIssueTitle(evaluation: AlertEvaluation): string {
  const title = `[STAGE][${evaluation.alert_id}] ${evaluation.evaluation_status} ${evaluation.function_or_service ?? ''}`.trim();
  return redactText(title, 120);
}

export function buildIssueBody(evaluation: AlertEvaluation): string {
  const lines = [
    BOT_MARKER,
    `${BOT_FINGERPRINT_PREFIX}${evaluation.fingerprint}`,
    '',
    `alert_id: ${evaluation.alert_id}`,
    `severity: ${evaluation.severity}`,
    `environment: ${evaluation.environment}`,
    `project_ref: ${evaluation.project_ref}`,
    `status: ${evaluation.evaluation_status}`,
    `observed_count: ${evaluation.observed_count}`,
    `window: ${evaluation.time_window.start} → ${evaluation.time_window.end}`,
    `evidence: ${redactText(evaluation.evidence_summary, 400)}`,
    '',
    'Automated by Both SYN-05 watchdog. Do not put secrets in comments.',
  ];
  return lines.join('\n');
}

export function parseFingerprintFromBody(body: string): string | null {
  const m = body.match(new RegExp(`${BOT_FINGERPRINT_PREFIX}([^\\s]+)`));
  return m?.[1] ?? null;
}

export function isBotOwned(incident: IncidentRecord): boolean {
  return (
    incident.labels.includes(BOT_LABEL) &&
    incident.body.includes(BOT_MARKER) &&
    Boolean(parseFingerprintFromBody(incident.body))
  );
}

/** In-memory fake for deterministic tests — no network. */
export class MemoryGithubIssues implements GithubIssuesPort {
  private seq = 0;
  readonly store = new Map<number, IncidentRecord>();

  async listBotIncidents(state: 'open' | 'closed' | 'all' = 'open'): Promise<IncidentRecord[]> {
    return [...this.store.values()].filter((i) => {
      if (!isBotOwned(i)) return false;
      if (state === 'all') return true;
      return i.state === state;
    });
  }

  async createIncident(evaluation: AlertEvaluation): Promise<IncidentRecord> {
    this.seq += 1;
    const now = new Date().toISOString();
    const rec: IncidentRecord = {
      fingerprint: evaluation.fingerprint,
      alert_id: evaluation.alert_id,
      number: this.seq,
      title: buildIssueTitle(evaluation),
      state: 'open',
      labels: [BOT_LABEL, 'syn05', evaluation.severity],
      body: buildIssueBody(evaluation),
      opened_at: now,
      last_seen_at: now,
      bot_marker: BOT_MARKER,
      consecutive_healthy: 0,
    };
    this.store.set(rec.number, rec);
    return { ...rec };
  }

  async updateIncident(incident: IncidentRecord, evaluation: AlertEvaluation): Promise<IncidentRecord> {
    if (!isBotOwned(incident)) throw new Error('refuse_non_bot_issue');
    const now = new Date().toISOString();
    const firing = evaluation.evaluation_status === 'FIRING';
    const next: IncidentRecord = {
      ...incident,
      title: buildIssueTitle(evaluation),
      body: buildIssueBody(evaluation),
      last_seen_at: now,
      // Firing resets recovery streak; recovering/healthy paths preserve caller bump.
      consecutive_healthy: firing ? 0 : incident.consecutive_healthy,
      state: 'open',
      resolved_at: undefined,
    };
    this.store.set(next.number, next);
    return { ...next };
  }

  async closeIncident(incident: IncidentRecord, evaluation: AlertEvaluation): Promise<IncidentRecord> {
    if (!isBotOwned(incident)) throw new Error('refuse_non_bot_issue');
    const now = new Date().toISOString();
    const next: IncidentRecord = {
      ...incident,
      state: 'closed',
      resolved_at: now,
      last_seen_at: now,
      body: `${buildIssueBody(evaluation)}\n\nresolved_at: ${now}`,
      consecutive_healthy: incident.consecutive_healthy + 1,
    };
    this.store.set(next.number, next);
    return { ...next };
  }

  /** Seed a human issue that must never be mutated. */
  seedHumanIssue(partial?: Partial<IncidentRecord>): IncidentRecord {
    this.seq += 1;
    const number = this.seq;
    const rec: IncidentRecord = {
      fingerprint: partial?.fingerprint ?? 'human',
      alert_id: partial?.alert_id ?? 'HUMAN',
      number,
      title: partial?.title ?? 'Human triage note',
      state: partial?.state ?? 'open',
      labels: partial?.labels ?? ['human'],
      body: partial?.body ?? 'manual',
      opened_at: partial?.opened_at ?? new Date().toISOString(),
      last_seen_at: partial?.last_seen_at ?? new Date().toISOString(),
      bot_marker: partial?.bot_marker ?? '',
      consecutive_healthy: partial?.consecutive_healthy ?? 0,
      resolved_at: partial?.resolved_at,
    };
    this.store.set(rec.number, rec);
    return rec;
  }
}

/**
 * Dry-run notifier: records intended mutations without calling GitHub.
 * Used when BOTH_WATCHDOG_DRY_RUN=1 (default).
 */
export class DryRunGithubIssues implements GithubIssuesPort {
  readonly planned: Array<{ op: string; fingerprint: string }> = [];
  private readonly inner: GithubIssuesPort;

  constructor(inner: GithubIssuesPort = new MemoryGithubIssues()) {
    this.inner = inner;
  }

  listBotIncidents(state?: 'open' | 'closed' | 'all') {
    return this.inner.listBotIncidents(state);
  }
  async createIncident(evaluation: AlertEvaluation) {
    this.planned.push({ op: 'create', fingerprint: evaluation.fingerprint });
    // Still mutate inner memory so reconciliation can be tested end-to-end in dry-run unit tests
    // when using MemoryGithubIssues; for pure plan-only, use Recording only.
    return this.inner.createIncident(evaluation);
  }
  async updateIncident(incident: IncidentRecord, evaluation: AlertEvaluation) {
    this.planned.push({ op: 'update', fingerprint: evaluation.fingerprint });
    return this.inner.updateIncident(incident, evaluation);
  }
  async closeIncident(incident: IncidentRecord, evaluation: AlertEvaluation) {
    this.planned.push({ op: 'close', fingerprint: evaluation.fingerprint });
    return this.inner.closeIncident(incident, evaluation);
  }
}
