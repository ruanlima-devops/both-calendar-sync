/**
 * Injectable GitHub HTTP transport — no real network by default.
 * Real fetch is never used unless explicitly injected by callers/tests.
 */

import { redactText } from './redact.ts';

export type GithubHttpRequest = {
  method: 'GET' | 'POST' | 'PATCH' | 'PUT';
  /** Path beginning with /repos/... — host fixed by adapter */
  path: string;
  body?: string;
  headers?: Record<string, string>;
};

export type GithubHttpResponse = {
  status: number;
  headers: Record<string, string>;
  body: string;
};

export type GithubHttpTransport = (req: GithubHttpRequest) => Promise<GithubHttpResponse>;

export class GithubHttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly retryAfterMs?: number,
  ) {
    super(redactText(message, 200));
    this.name = 'GithubHttpError';
  }
}

/** In-memory fake GitHub Issues API for offline tests. */
export class FakeGithubIssuesTransport {
  issues = new Map<
    number,
    {
      number: number;
      title: string;
      body: string;
      state: 'open' | 'closed';
      labels: string[];
      created_at: string;
      updated_at: string;
    }
  >();
  private seq = 0;
  readonly calls: GithubHttpRequest[] = [];
  /** Scripted responses by call index or path prefix */
  script: Array<GithubHttpResponse | ((req: GithubHttpRequest) => GithubHttpResponse)> = [];
  failNext?: GithubHttpResponse;
  /** When true, first POST create returns 500 then succeeds on retry path handled by client */
  createFlaky = false;
  private createAttempts = 0;

  transport: GithubHttpTransport = async (req) => {
    this.calls.push({ ...req, headers: { ...(req.headers ?? {}) } });
    if (this.failNext) {
      const r = this.failNext;
      this.failNext = undefined;
      return r;
    }
    if (this.script.length) {
      const next = this.script.shift()!;
      return typeof next === 'function' ? next(req) : next;
    }
    return this.handle(req);
  };

  private handle(req: GithubHttpRequest): GithubHttpResponse {
    const url = new URL(req.path, 'https://api.github.com');
    const path = url.pathname;

    if (req.method === 'GET' && /\/repos\/[^/]+\/[^/]+\/issues$/.test(path)) {
      const state = url.searchParams.get('state') ?? 'open';
      const labels = (url.searchParams.get('labels') ?? '').split(',').filter(Boolean);
      let list = [...this.issues.values()];
      if (state !== 'all') list = list.filter((i) => i.state === state);
      if (labels.length) {
        list = list.filter((i) => labels.every((l) => i.labels.includes(l)));
      }
      list.sort((a, b) => a.number - b.number);
      return { status: 200, headers: {}, body: JSON.stringify(list) };
    }

    const issueMatch = path.match(/\/repos\/[^/]+\/[^/]+\/issues\/(\d+)$/);
    if (issueMatch && req.method === 'GET') {
      const n = Number(issueMatch[1]);
      const issue = this.issues.get(n);
      if (!issue) return { status: 404, headers: {}, body: JSON.stringify({ message: 'Not Found' }) };
      return { status: 200, headers: {}, body: JSON.stringify(issue) };
    }

    if (issueMatch && req.method === 'PATCH') {
      const n = Number(issueMatch[1]);
      const issue = this.issues.get(n);
      if (!issue) return { status: 404, headers: {}, body: JSON.stringify({ message: 'Not Found' }) };
      const patch = JSON.parse(req.body || '{}') as {
        title?: string;
        body?: string;
        state?: 'open' | 'closed';
        labels?: string[];
      };
      const next = {
        ...issue,
        title: patch.title ?? issue.title,
        body: patch.body ?? issue.body,
        state: patch.state ?? issue.state,
        labels: patch.labels ?? issue.labels,
        updated_at: new Date().toISOString(),
      };
      this.issues.set(n, next);
      return { status: 200, headers: {}, body: JSON.stringify(next) };
    }

    if (req.method === 'POST' && /\/repos\/[^/]+\/[^/]+\/issues$/.test(path)) {
      this.createAttempts += 1;
      if (this.createFlaky && this.createAttempts === 1) {
        return { status: 500, headers: {}, body: JSON.stringify({ message: 'server error' }) };
      }
      const payload = JSON.parse(req.body || '{}') as {
        title?: string;
        body?: string;
        labels?: string[];
      };
      this.seq += 1;
      const now = new Date().toISOString();
      const issue = {
        number: this.seq,
        title: payload.title ?? 'untitled',
        body: payload.body ?? '',
        state: 'open' as const,
        labels: payload.labels ?? [],
        created_at: now,
        updated_at: now,
      };
      this.issues.set(issue.number, issue);
      return { status: 201, headers: {}, body: JSON.stringify(issue) };
    }

    return { status: 404, headers: {}, body: JSON.stringify({ message: 'unhandled_fake_route' }) };
  }
}
