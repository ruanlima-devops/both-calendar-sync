/**
 * GitHub Issues adapter (C3-prep) — transport-injected only.
 * Never imports global fetch. Never enabled by C0 runtime factory.
 */

import {
  buildIssueBody,
  buildIssueTitle,
  isBotOwned,
  parseFingerprintFromBody,
  type GithubIssuesPort,
} from './github-issues.ts';
import {
  applyEvaluationToState,
  hydrateIncidentFromBody,
  parseIncidentState,
  pickCanonicalIncident,
  upsertIncidentStateBlock,
  type IncidentStateV1,
} from './incident-state.ts';
import {
  GithubHttpError,
  type GithubHttpResponse,
  type GithubHttpTransport,
} from './github-http.ts';
import { redactText } from './redact.ts';
import {
  BOT_LABEL,
  BOT_MARKER,
  STAGE_ENVIRONMENT,
  STAGE_PROJECT_REF,
  type AlertEvaluation,
  type IncidentRecord,
} from './types.ts';

export type HttpGithubIssuesOptions = {
  owner: string;
  repo: string;
  /** Required — never read from env here to avoid accidental token use */
  token: string;
  transport: GithubHttpTransport;
  label?: string;
  maxRetries?: number;
  sleep?: (ms: number) => Promise<void>;
};

const ALLOWED_OWNER = 'ruanlima-devops';
const ALLOWED_REPO = 'both-calendar-sync';

function assertRepo(owner: string, repo: string): void {
  if (owner !== ALLOWED_OWNER || repo !== ALLOWED_REPO) {
    throw new Error(`github_repo_not_allowlisted:${redactText(`${owner}/${repo}`, 80)}`);
  }
}

function assertHttpsPath(path: string): void {
  if (!path.startsWith('/repos/')) throw new Error('github_path_rejected');
  if (path.includes('://') || path.includes('@')) throw new Error('github_path_injection');
}

type GhIssue = {
  number: number;
  title: string;
  body?: string | null;
  state: 'open' | 'closed';
  labels?: Array<string | { name?: string }>;
  created_at?: string;
  updated_at?: string;
};

function labelNames(labels: GhIssue['labels']): string[] {
  if (!labels) return [];
  return labels.map((l) => (typeof l === 'string' ? l : l.name ?? '')).filter(Boolean);
}

function toRecord(issue: GhIssue): IncidentRecord {
  const body = issue.body ?? '';
  const fp = parseFingerprintFromBody(body) ?? 'unknown';
  const labels = labelNames(issue.labels);
  const base: IncidentRecord = {
    fingerprint: fp,
    alert_id: 'ALERT-01',
    number: issue.number,
    title: issue.title,
    state: issue.state,
    labels,
    body,
    opened_at: issue.created_at ?? new Date().toISOString(),
    last_seen_at: issue.updated_at ?? new Date().toISOString(),
    bot_marker: BOT_MARKER,
    consecutive_healthy: 0,
    resolved_at: issue.state === 'closed' ? issue.updated_at : undefined,
  };
  const parsed = parseIncidentState(body);
  if (parsed.ok && parsed.trusted) {
    base.alert_id = parsed.state.alert_id;
    base.fingerprint = parsed.state.fingerprint;
  }
  return hydrateIncidentFromBody(base);
}

export class HttpGithubIssues implements GithubIssuesPort {
  private readonly owner: string;
  private readonly repo: string;
  private readonly token: string;
  private readonly transport: GithubHttpTransport;
  private readonly label: string;
  private readonly maxRetries: number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(opts: HttpGithubIssuesOptions) {
    assertRepo(opts.owner, opts.repo);
    if (!opts.token || opts.token.length < 8) throw new Error('github_token_missing');
    if (!opts.transport) throw new Error('github_transport_required');
    this.owner = opts.owner;
    this.repo = opts.repo;
    this.token = opts.token;
    this.transport = opts.transport;
    this.label = opts.label ?? BOT_LABEL;
    this.maxRetries = opts.maxRetries ?? 3;
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  private async request(
    method: 'GET' | 'POST' | 'PATCH',
    path: string,
    body?: unknown,
  ): Promise<GithubHttpResponse> {
    assertHttpsPath(path);
    let attempts = 0;
    let lastErr: GithubHttpError | undefined;
    while (attempts <= this.maxRetries) {
      attempts += 1;
      const res = await this.transport({
        method,
        path,
        body: body === undefined ? undefined : JSON.stringify(body),
        headers: {
          Accept: 'application/vnd.github+json',
          Authorization: `Bearer ${this.token}`,
          'Content-Type': 'application/json',
          'X-GitHub-Api-Version': '2022-11-28',
        },
      });
      if (res.status === 429) {
        const ra = Number(res.headers['retry-after'] || res.headers['Retry-After'] || '');
        const wait = (Number.isFinite(ra) && ra > 0 ? ra * 1000 : 500 * 2 ** (attempts - 1)) + 50;
        if (attempts > this.maxRetries) {
          throw new GithubHttpError('rate_limited', 429, wait);
        }
        await this.sleep(Math.min(wait, 15_000));
        continue;
      }
      if (res.status >= 500) {
        lastErr = new GithubHttpError(`upstream_${res.status}`, res.status);
        if (attempts > this.maxRetries) throw lastErr;
        await this.sleep(500 * 2 ** (attempts - 1));
        continue;
      }
      if (res.status === 403 || res.status === 404 || res.status === 409 || res.status === 422) {
        throw new GithubHttpError(`http_${res.status}`, res.status);
      }
      if (res.status < 200 || res.status >= 300) {
        throw new GithubHttpError(`http_${res.status}`, res.status);
      }
      return res;
    }
    throw lastErr ?? new GithubHttpError('exhausted_retries', 500);
  }

  private basePath(): string {
    return `/repos/${this.owner}/${this.repo}/issues`;
  }

  async listBotIncidents(state: 'open' | 'closed' | 'all' = 'open'): Promise<IncidentRecord[]> {
    const q = new URLSearchParams({
      state: state === 'all' ? 'all' : state,
      labels: this.label,
      per_page: '100',
    });
    const res = await this.request('GET', `${this.basePath()}?${q}`);
    let parsed: unknown;
    try {
      parsed = JSON.parse(res.body);
    } catch {
      throw new GithubHttpError('invalid_json', res.status);
    }
    if (!Array.isArray(parsed)) throw new GithubHttpError('invalid_payload', res.status);
    const out: IncidentRecord[] = [];
    for (const item of parsed) {
      if (!item || typeof item !== 'object') continue;
      const rec = toRecord(item as GhIssue);
      if (!isBotOwned(rec)) continue;
      // STAGE isolation via state block when present
      const st = parseIncidentState(rec.body);
      if (st.ok && st.trusted) {
        if (st.state.project_ref !== STAGE_PROJECT_REF) continue;
        if (st.state.environment !== STAGE_ENVIRONMENT) continue;
      }
      out.push(rec);
    }
    return out;
  }

  /** Search-before-create helper */
  async findOpenByFingerprint(fingerprint: string): Promise<IncidentRecord | null> {
    const open = await this.listBotIncidents('open');
    const matches = open.filter((i) => i.fingerprint === fingerprint);
    return pickCanonicalIncident(matches);
  }

  async createIncident(evaluation: AlertEvaluation): Promise<IncidentRecord> {
    const existing = await this.findOpenByFingerprint(evaluation.fingerprint);
    if (existing) {
      return this.updateIncident(existing, evaluation);
    }
    const now = new Date().toISOString();
    const { state } = applyEvaluationToState(null, evaluation, now);
    const body = upsertIncidentStateBlock(buildIssueBody(evaluation), state);
    try {
      const res = await this.request('POST', this.basePath(), {
        title: buildIssueTitle(evaluation),
        body,
        labels: [this.label, 'syn05', evaluation.severity, `project:${STAGE_PROJECT_REF}`],
      });
      let issue: GhIssue;
      try {
        issue = JSON.parse(res.body) as GhIssue;
      } catch {
        throw new GithubHttpError('invalid_json', res.status);
      }
      return toRecord(issue);
    } catch (err) {
      // Partial failure after create: re-search before bubbling
      if (err instanceof GithubHttpError && (err.status >= 500 || err.status === 429)) {
        const again = await this.findOpenByFingerprint(evaluation.fingerprint);
        if (again) return again;
      }
      throw err;
    }
  }

  async updateIncident(incident: IncidentRecord, evaluation: AlertEvaluation): Promise<IncidentRecord> {
    if (!isBotOwned(incident)) throw new Error('refuse_non_bot_issue');
    const now = new Date().toISOString();
    const prevParsed = parseIncidentState(incident.body);
    const prev: IncidentStateV1 | null =
      prevParsed.ok && prevParsed.trusted ? prevParsed.state : null;
    const { state, skipDuplicateSample } = applyEvaluationToState(prev, evaluation, now);
    const consecutive = skipDuplicateSample
      ? incident.consecutive_healthy
      : state.consecutive_healthy;
    const firing = evaluation.evaluation_status === 'FIRING';
    const nextState = {
      ...state,
      consecutive_healthy: firing ? 0 : consecutive,
    };
    const body = upsertIncidentStateBlock(buildIssueBody(evaluation), nextState);
    const res = await this.request('PATCH', `${this.basePath()}/${incident.number}`, {
      title: buildIssueTitle(evaluation),
      body,
      state: 'open',
      labels: [this.label, 'syn05', evaluation.severity, `project:${STAGE_PROJECT_REF}`],
    });
    return toRecord(JSON.parse(res.body) as GhIssue);
  }

  async closeIncident(incident: IncidentRecord, evaluation: AlertEvaluation): Promise<IncidentRecord> {
    if (!isBotOwned(incident)) throw new Error('refuse_non_bot_issue');
    const now = new Date().toISOString();
    const prevParsed = parseIncidentState(incident.body);
    const prev = prevParsed.ok && prevParsed.trusted ? prevParsed.state : null;
    // Fail-closed: refuse close when neither durable nor in-memory streak is sufficient
    const effective = Math.max(prev?.consecutive_healthy ?? 0, incident.consecutive_healthy);
    if (effective < 2) {
      throw new Error('close_refused_insufficient_healthy_streak');
    }
    const { state } = applyEvaluationToState(prev, evaluation, now);
    const closedState: IncidentStateV1 = {
      ...state,
      alert_status: 'RESOLVED',
      consecutive_healthy: Math.max(state.consecutive_healthy, 2),
      last_transition_at: now,
    };
    const body = upsertIncidentStateBlock(
      `${buildIssueBody(evaluation)}\n\nresolved_at: ${now}`,
      closedState,
    );
    const res = await this.request('PATCH', `${this.basePath()}/${incident.number}`, {
      title: buildIssueTitle(evaluation),
      body,
      state: 'closed',
    });
    return toRecord(JSON.parse(res.body) as GhIssue);
  }
}

/** C0 factory: never returns HttpGithubIssues. */
export function createC0IssueStore(): GithubIssuesPort {
  // Lazy import avoided — caller uses Memory/DryRun from github-issues.ts
  throw new Error('use_memory_or_dryrun_in_c0');
}

/** Feature flag for future C3-B — remains disabled. */
export function isRealGithubIssuesEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return (
    env.BOTH_WATCHDOG_GITHUB_HTTP === '1' &&
    env.BOTH_WATCHDOG_GITHUB_WRITE === '1' &&
    env.BOTH_WATCHDOG_DRY_RUN === '0'
  );
}
