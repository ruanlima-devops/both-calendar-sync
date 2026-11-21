/**
 * GitHub Issues adapter (C3-B.1) — transport-injected, host-pinned paths.
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
  ALLOWED_GITHUB_OWNER,
  ALLOWED_GITHUB_REPO,
  assertGithubIssuesPath,
  GithubHttpError,
  parseGithubNextLink,
  type GithubHttpResponse,
  type GithubHttpTransport,
  type IssuesListCompleteness,
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
  token: string;
  transport: GithubHttpTransport;
  label?: string;
  maxRetries?: number;
  maxPages?: number;
  maxIssues?: number;
  sleep?: (ms: number) => Promise<void>;
};

export class SearchIncompleteError extends Error {
  readonly code = 'search_incomplete';
  constructor(message = 'issues_search_incomplete') {
    super(redactText(message, 160));
    this.name = 'SearchIncompleteError';
  }
}

export class ReconcileRequiredError extends Error {
  readonly code = 'reconcile_required';
  constructor(message = 'reconcile_required') {
    super(redactText(message, 160));
    this.name = 'ReconcileRequiredError';
  }
}

export class AmbiguousCreateError extends Error {
  readonly code = 'ambiguous_create';
  constructor(message = 'ambiguous_create_outcome') {
    super(redactText(message, 160));
    this.name = 'AmbiguousCreateError';
  }
}

type GhIssue = {
  number: number;
  title: string;
  body?: string | null;
  state: 'open' | 'closed';
  labels?: Array<string | { name?: string }>;
  created_at?: string;
  updated_at?: string;
  pull_request?: unknown;
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

function isPullRequestIssue(issue: GhIssue): boolean {
  return issue.pull_request != null;
}

export class HttpGithubIssues implements GithubIssuesPort {
  private readonly owner: string;
  private readonly repo: string;
  private readonly token: string;
  private readonly transport: GithubHttpTransport;
  private readonly label: string;
  private readonly maxRetries: number;
  private readonly maxPages: number;
  private readonly maxIssues: number;
  private readonly sleep: (ms: number) => Promise<void>;
  /** Sanitized metadata for last ambiguous create (no secrets). */
  lastAmbiguousCreate: { fingerprint: string; at: string } | null = null;

  constructor(opts: HttpGithubIssuesOptions) {
    if (opts.owner !== ALLOWED_GITHUB_OWNER || opts.repo !== ALLOWED_GITHUB_REPO) {
      throw new Error(`github_repo_not_allowlisted:${redactText(`${opts.owner}/${opts.repo}`, 80)}`);
    }
    if (!opts.token || opts.token.length < 8) throw new Error('github_token_missing');
    if (!opts.transport) throw new Error('github_transport_required');
    this.owner = opts.owner;
    this.repo = opts.repo;
    this.token = opts.token;
    this.transport = opts.transport;
    this.label = opts.label ?? BOT_LABEL;
    this.maxRetries = opts.maxRetries ?? 3;
    this.maxPages = opts.maxPages ?? 10;
    this.maxIssues = opts.maxIssues ?? 1000;
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  private async request(
    method: 'GET' | 'POST' | 'PATCH',
    path: string,
    body?: unknown,
    opts?: { retryNonIdempotent?: boolean },
  ): Promise<GithubHttpResponse> {
    assertGithubIssuesPath(path);
    let attempts = 0;
    let lastErr: GithubHttpError | undefined;
    const allowRetryNonIdempotent = opts?.retryNonIdempotent ?? false;
    while (attempts <= this.maxRetries) {
      attempts += 1;
      try {
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
            throw new GithubHttpError('rate_limited', 429, wait, 'rate_limited');
          }
          await this.sleep(Math.min(wait, 15_000));
          continue;
        }
        if (res.status >= 500) {
          lastErr = new GithubHttpError(`upstream_${res.status}`, res.status, undefined, 'upstream');
          // POST create: do not blind-retry after possible success — only if explicitly allowed (GET/PATCH)
          if (method === 'POST' && !allowRetryNonIdempotent) {
            throw lastErr;
          }
          if (attempts > this.maxRetries) throw lastErr;
          await this.sleep(500 * 2 ** (attempts - 1));
          continue;
        }
        if (res.status === 401 || res.status === 403) {
          throw new GithubHttpError('unauthorized', res.status, undefined, 'unauthorized');
        }
        if (res.status === 404) {
          throw new GithubHttpError('not_found', 404, undefined, 'not_found');
        }
        if (res.status === 409 || res.status === 422) {
          throw new GithubHttpError(`http_${res.status}`, res.status, undefined, 'conflict');
        }
        if (res.status < 200 || res.status >= 300) {
          throw new GithubHttpError(`http_${res.status}`, res.status);
        }
        return res;
      } catch (err) {
        if (err instanceof GithubHttpError && err.code === 'timeout') {
          throw err;
        }
        if (err instanceof GithubHttpError) throw err;
        const msg = err instanceof Error ? err.message : String(err);
        if (/abort|timeout/i.test(msg)) {
          throw new GithubHttpError('timeout', 0, undefined, 'timeout');
        }
        throw new GithubHttpError(redactText(msg, 160), 0, undefined, 'transport_error');
      }
    }
    throw lastErr ?? new GithubHttpError('exhausted_retries', 500);
  }

  private basePath(): string {
    return `/repos/${this.owner}/${this.repo}/issues`;
  }

  /**
   * List bot incidents with pagination. Fail-closed incompleteness.
   */
  async listBotIncidentsDetailed(
    state: 'open' | 'closed' | 'all' = 'open',
  ): Promise<{ incidents: IncidentRecord[]; completeness: IssuesListCompleteness; pages: number }> {
    const incidents: IncidentRecord[] = [];
    let page = 1;
    let path: string | null = `${this.basePath()}?${new URLSearchParams({
      state: state === 'all' ? 'all' : state,
      labels: this.label,
      per_page: '100',
      page: '1',
    }).toString()}`;
    let pages = 0;

    while (path) {
      if (pages >= this.maxPages || incidents.length >= this.maxIssues) {
        return { incidents, completeness: 'incomplete', pages };
      }
      let res: GithubHttpResponse;
      try {
        res = await this.request('GET', path, undefined, { retryNonIdempotent: true });
      } catch (err) {
        if (err instanceof GithubHttpError && (err.code === 'timeout' || err.status >= 500 || err.status === 429)) {
          return { incidents, completeness: 'incomplete', pages };
        }
        throw err;
      }
      pages += 1;
      let parsed: unknown;
      try {
        parsed = JSON.parse(res.body);
      } catch {
        throw new GithubHttpError('invalid_json', res.status, undefined, 'invalid_json');
      }
      if (!Array.isArray(parsed)) {
        throw new GithubHttpError('invalid_payload', res.status, undefined, 'invalid_payload');
      }
      for (const item of parsed) {
        if (!item || typeof item !== 'object') continue;
        const raw = item as GhIssue;
        if (isPullRequestIssue(raw)) continue;
        const rec = toRecord(raw);
        if (!isBotOwned(rec)) continue;
        const st = parseIncidentState(rec.body);
        if (st.ok && st.trusted) {
          if (st.state.project_ref !== STAGE_PROJECT_REF) continue;
          if (st.state.environment !== STAGE_ENVIRONMENT) continue;
        }
        incidents.push(rec);
        if (incidents.length >= this.maxIssues) {
          return { incidents, completeness: 'incomplete', pages };
        }
      }
      try {
        path = parseGithubNextLink(res.headers['link'] || res.headers['Link']);
      } catch {
        return { incidents, completeness: 'incomplete', pages };
      }
      if (path) {
        // next link already path-only from parser
        page += 1;
        if (page > this.maxPages) {
          return { incidents, completeness: 'incomplete', pages };
        }
      }
    }
    return { incidents, completeness: 'complete', pages };
  }

  async listBotIncidents(state: 'open' | 'closed' | 'all' = 'open'): Promise<IncidentRecord[]> {
    const { incidents, completeness } = await this.listBotIncidentsDetailed(state);
    if (completeness !== 'complete') {
      throw new SearchIncompleteError('list_incomplete');
    }
    return incidents;
  }

  async findOpenByFingerprint(fingerprint: string): Promise<IncidentRecord | null> {
    const { incidents, completeness } = await this.listBotIncidentsDetailed('open');
    if (completeness !== 'complete') {
      throw new SearchIncompleteError('find_open_incomplete');
    }
    const matches = incidents.filter((i) => i.fingerprint === fingerprint);
    return pickCanonicalIncident(matches);
  }

  /** Closed bot issues with fingerprint — for safe reopen. */
  async findClosedByFingerprint(fingerprint: string): Promise<IncidentRecord | null> {
    const { incidents, completeness } = await this.listBotIncidentsDetailed('closed');
    if (completeness !== 'complete') {
      throw new SearchIncompleteError('find_closed_incomplete');
    }
    const matches = incidents.filter((i) => i.fingerprint === fingerprint && i.state === 'closed');
    if (matches.length > 1) {
      // Multiple closed with same fp — cannot pick safely for reopen
      throw new ReconcileRequiredError('multiple_closed_candidates');
    }
    return pickCanonicalIncident(matches);
  }

  async createIncident(evaluation: AlertEvaluation): Promise<IncidentRecord> {
    // Complete search required before create
    let existing: IncidentRecord | null;
    try {
      existing = await this.findOpenByFingerprint(evaluation.fingerprint);
    } catch (err) {
      if (err instanceof SearchIncompleteError) throw err;
      throw err;
    }
    if (existing) {
      return this.updateIncident(existing, evaluation);
    }

    // Prefer reopen closed bot issue over new create when valid
    try {
      const closed = await this.findClosedByFingerprint(evaluation.fingerprint);
      if (closed) {
        return this.reopenIncident(closed, evaluation);
      }
    } catch (err) {
      if (err instanceof SearchIncompleteError || err instanceof ReconcileRequiredError) throw err;
      throw err;
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
        throw new GithubHttpError('invalid_json', res.status, undefined, 'invalid_json');
      }
      return toRecord(issue);
    } catch (err) {
      // Ambiguous create: timeout or 5xx after POST — NEVER blind-retry POST
      if (
        err instanceof GithubHttpError &&
        (err.code === 'timeout' || err.status >= 500 || err.status === 429)
      ) {
        this.lastAmbiguousCreate = {
          fingerprint: evaluation.fingerprint,
          at: new Date().toISOString(),
        };
        try {
          const again = await this.findOpenByFingerprint(evaluation.fingerprint);
          if (again) return again;
        } catch (searchErr) {
          if (searchErr instanceof SearchIncompleteError) {
            throw searchErr;
          }
          throw new AmbiguousCreateError('create_ambiguous_search_failed');
        }
        // Complete empty search after ambiguous create → do NOT assume create failed; block blind retry
        throw new AmbiguousCreateError('create_ambiguous_no_issue_found');
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

  /**
   * Safe reopen of a closed bot-owned STAGE issue on FIRING evidence.
   */
  async reopenIncident(incident: IncidentRecord, evaluation: AlertEvaluation): Promise<IncidentRecord> {
    if (!isBotOwned(incident)) throw new Error('refuse_non_bot_issue');
    if (incident.state !== 'closed') {
      return this.updateIncident(incident, evaluation);
    }
    if (
      evaluation.evaluation_status === 'UNKNOWN' ||
      evaluation.evaluation_status === 'DATA_UNAVAILABLE'
    ) {
      throw new Error('reopen_refused_incomplete_evaluation');
    }
    if (evaluation.evaluation_status !== 'FIRING') {
      throw new Error('reopen_refused_not_firing');
    }
    const prevParsed = parseIncidentState(incident.body);
    if (!prevParsed.ok || !prevParsed.trusted) {
      throw new Error('reopen_refused_corrupt_state');
    }
    if (prevParsed.state.project_ref !== STAGE_PROJECT_REF) {
      throw new Error('reopen_refused_project_mismatch');
    }
    if (prevParsed.state.environment !== STAGE_ENVIRONMENT) {
      throw new Error('reopen_refused_environment_mismatch');
    }
    if (prevParsed.state.fingerprint !== evaluation.fingerprint) {
      throw new Error('reopen_refused_fingerprint_mismatch');
    }
    // Conservative: refuse reopen if closed sample window is newer than firing window (stale alert)
    if (
      prevParsed.state.last_sample_window_end &&
      evaluation.time_window.end &&
      Date.parse(evaluation.time_window.end) < Date.parse(prevParsed.state.last_sample_window_end)
    ) {
      throw new Error('reopen_refused_stale_sample');
    }

    const now = new Date().toISOString();
    // Reset streak on reopen/FIRING
    const { state } = applyEvaluationToState(
      { ...prevParsed.state, consecutive_healthy: 0, alert_status: 'FIRING' },
      evaluation,
      now,
    );
    const nextState: IncidentStateV1 = {
      ...state,
      consecutive_healthy: 0,
      alert_status: 'FIRING',
      last_transition_at: now,
    };
    // Preserve human text outside controlled block via upsert
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
    if (
      evaluation.evaluation_status === 'UNKNOWN' ||
      evaluation.evaluation_status === 'DATA_UNAVAILABLE'
    ) {
      throw new Error('close_refused_incomplete_evaluation');
    }
    const now = new Date().toISOString();
    const prevParsed = parseIncidentState(incident.body);
    const prev = prevParsed.ok && prevParsed.trusted ? prevParsed.state : null;
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
    try {
      const res = await this.request('PATCH', `${this.basePath()}/${incident.number}`, {
        title: buildIssueTitle(evaluation),
        body,
        state: 'closed',
      });
      return toRecord(JSON.parse(res.body) as GhIssue);
    } catch (err) {
      if (err instanceof GithubHttpError && err.code === 'timeout') {
        throw new GithubHttpError('close_timeout', 0, undefined, 'timeout');
      }
      throw err;
    }
  }
}

export function createC0IssueStore(): GithubIssuesPort {
  throw new Error('use_memory_or_dryrun_in_c0');
}

export function isRealGithubIssuesEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return (
    env.BOTH_WATCHDOG_GITHUB_HTTP === '1' &&
    env.BOTH_WATCHDOG_GITHUB_WRITE === '1' &&
    env.BOTH_WATCHDOG_DRY_RUN === '0'
  );
}
