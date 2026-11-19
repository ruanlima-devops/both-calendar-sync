/**
 * GitHub Issues adapter — interface + in-memory fake + DryRun.
 * Real HTTP adapter lives in http-github-issues.ts (transport-injected; not used in C0).
 * Write path gated behind BOTH_WATCHDOG_GITHUB_WRITE=1 (never set in this phase).
 */

import {
  applyEvaluationToState,
  hydrateIncidentFromBody,
  parseIncidentState,
  pickCanonicalIncident,
  upsertIncidentStateBlock,
} from './incident-state.ts';
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
  /** Optional search-before-create; Memory/Http implement. */
  findOpenByFingerprint?(fingerprint: string): Promise<IncidentRecord | null>;
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

/** In-memory fake for deterministic tests — no network. Embeds durable state in body. */
export class MemoryGithubIssues implements GithubIssuesPort {
  private seq = 0;
  readonly store = new Map<number, IncidentRecord>();

  async listBotIncidents(state: 'open' | 'closed' | 'all' = 'open'): Promise<IncidentRecord[]> {
    return [...this.store.values()]
      .filter((i) => {
        if (!isBotOwned(i)) return false;
        if (state === 'all') return true;
        return i.state === state;
      })
      .map((i) => hydrateIncidentFromBody({ ...i }));
  }

  async findOpenByFingerprint(fingerprint: string): Promise<IncidentRecord | null> {
    const open = await this.listBotIncidents('open');
    return pickCanonicalIncident(open.filter((i) => i.fingerprint === fingerprint));
  }

  async createIncident(evaluation: AlertEvaluation): Promise<IncidentRecord> {
    const existing = await this.findOpenByFingerprint(evaluation.fingerprint);
    if (existing) return this.updateIncident(existing, evaluation);

    this.seq += 1;
    const now = new Date().toISOString();
    const { state } = applyEvaluationToState(null, evaluation, now);
    const body = upsertIncidentStateBlock(buildIssueBody(evaluation), state);
    const rec: IncidentRecord = {
      fingerprint: evaluation.fingerprint,
      alert_id: evaluation.alert_id,
      number: this.seq,
      title: buildIssueTitle(evaluation),
      state: 'open',
      labels: [BOT_LABEL, 'syn05', evaluation.severity],
      body,
      opened_at: now,
      last_seen_at: now,
      bot_marker: BOT_MARKER,
      consecutive_healthy: state.consecutive_healthy,
    };
    this.store.set(rec.number, rec);
    return hydrateIncidentFromBody({ ...rec });
  }

  async updateIncident(incident: IncidentRecord, evaluation: AlertEvaluation): Promise<IncidentRecord> {
    if (!isBotOwned(incident)) throw new Error('refuse_non_bot_issue');
    const now = new Date().toISOString();
    const prevParsed = parseIncidentState(incident.body);
    const prev = prevParsed.ok && prevParsed.trusted ? prevParsed.state : null;
    const { state, skipDuplicateSample } = applyEvaluationToState(prev, evaluation, now);
    const firing = evaluation.evaluation_status === 'FIRING';
    const consecutive = firing
      ? 0
      : skipDuplicateSample
        ? incident.consecutive_healthy
        : state.consecutive_healthy;
    const nextState = { ...state, consecutive_healthy: consecutive };
    const next: IncidentRecord = {
      ...incident,
      title: buildIssueTitle(evaluation),
      body: upsertIncidentStateBlock(buildIssueBody(evaluation), nextState),
      last_seen_at: now,
      consecutive_healthy: consecutive,
      state: 'open',
      resolved_at: undefined,
    };
    this.store.set(next.number, next);
    return hydrateIncidentFromBody({ ...next });
  }

  async closeIncident(incident: IncidentRecord, evaluation: AlertEvaluation): Promise<IncidentRecord> {
    if (!isBotOwned(incident)) throw new Error('refuse_non_bot_issue');
    const now = new Date().toISOString();
    const prevParsed = parseIncidentState(incident.body);
    const prev = prevParsed.ok && prevParsed.trusted ? prevParsed.state : null;
    const { state } = applyEvaluationToState(prev, evaluation, now);
    const closedState = {
      ...state,
      alert_status: 'RESOLVED' as const,
      consecutive_healthy: Math.max(state.consecutive_healthy, incident.consecutive_healthy, 2),
      last_transition_at: now,
    };
    const next: IncidentRecord = {
      ...incident,
      state: 'closed',
      resolved_at: now,
      last_seen_at: now,
      body: upsertIncidentStateBlock(`${buildIssueBody(evaluation)}\n\nresolved_at: ${now}`, closedState),
      consecutive_healthy: closedState.consecutive_healthy,
    };
    this.store.set(next.number, next);
    return hydrateIncidentFromBody({ ...next });
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

  /** Simulate process restart: new Memory hydrated only from body snapshots. */
  static fromSerializedBodies(records: IncidentRecord[]): MemoryGithubIssues {
    const mem = new MemoryGithubIssues();
    for (const r of records) {
      mem.seq = Math.max(mem.seq, r.number);
      mem.store.set(r.number, { ...r });
    }
    return mem;
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
  findOpenByFingerprint(fingerprint: string) {
    return this.inner.findOpenByFingerprint?.(fingerprint) ?? Promise.resolve(null);
  }
  async createIncident(evaluation: AlertEvaluation) {
    this.planned.push({ op: 'create', fingerprint: evaluation.fingerprint });
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
