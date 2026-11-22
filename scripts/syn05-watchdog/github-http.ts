/**
 * Injectable GitHub HTTP transport — no real network by default.
 * PinnedGithubHttpTransport enforces api.github.com host pin + redirect:error.
 */

import { redactText } from './redact.ts';

export const GITHUB_API_ORIGIN = 'https://api.github.com' as const;
export const ALLOWED_GITHUB_OWNER = 'ruanlima-devops' as const;
export const ALLOWED_GITHUB_REPO = 'both-calendar-sync' as const;

export type GithubHttpMethod = 'GET' | 'POST' | 'PATCH';

export type GithubHttpRequest = {
  method: GithubHttpMethod;
  /** Path beginning with /repos/... — host fixed by pinned transport */
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
  readonly status: number;
  readonly retryAfterMs?: number;
  readonly code?: string;
  constructor(message: string, status: number, retryAfterMs?: number, code?: string) {
    super(redactText(message, 200));
    this.name = 'GithubHttpError';
    this.status = status;
    this.retryAfterMs = retryAfterMs;
    this.code = code;
  }
}

/** Fail-closed search completeness signal for Issues listing. */
export type IssuesListCompleteness = 'complete' | 'incomplete';

const ALLOWED_ISSUE_PATH =
  /^\/repos\/ruanlima-devops\/both-calendar-sync\/issues(?:\/\d+)?(?:\?.*)?$/;

export function assertGithubIssuesPath(path: string): void {
  if (!path.startsWith('/')) throw new GithubHttpError('github_path_must_be_absolute', 400, undefined, 'path_rejected');
  if (path.includes('://') || path.includes('@') || path.includes('\\')) {
    throw new GithubHttpError('github_path_injection', 400, undefined, 'path_rejected');
  }
  const bare = path.split('?')[0] ?? path;
  if (!ALLOWED_ISSUE_PATH.test(path) && !ALLOWED_ISSUE_PATH.test(bare)) {
    // Allow /issues?query and /issues/N
    if (!bare.startsWith(`/repos/${ALLOWED_GITHUB_OWNER}/${ALLOWED_GITHUB_REPO}/issues`)) {
      throw new GithubHttpError('github_path_not_allowlisted', 400, undefined, 'path_rejected');
    }
  }
}

export function assertGithubApiUrl(url: URL): void {
  if (url.protocol !== 'https:') {
    throw new GithubHttpError('github_https_required', 400, undefined, 'host_rejected');
  }
  if (url.hostname !== 'api.github.com') {
    throw new GithubHttpError('github_host_not_allowlisted', 400, undefined, 'host_rejected');
  }
  if (url.port && url.port !== '443') {
    throw new GithubHttpError('github_port_rejected', 400, undefined, 'host_rejected');
  }
  if (url.username || url.password) {
    throw new GithubHttpError('github_url_credentials_rejected', 400, undefined, 'host_rejected');
  }
}

/**
 * Wrap an underlying fetch-like transport with hard host/path/method pin.
 * Never forwards Authorization to a non-pinned host (blocked before send).
 */
export function createPinnedGithubTransport(opts: {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}): GithubHttpTransport {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const timeoutMs = opts.timeoutMs ?? 30_000;
  return async (req) => {
    if (req.method !== 'GET' && req.method !== 'POST' && req.method !== 'PATCH') {
      throw new GithubHttpError('github_method_rejected', 400, undefined, 'method_rejected');
    }
    assertGithubIssuesPath(req.path);
    const url = new URL(req.path, GITHUB_API_ORIGIN);
    assertGithubApiUrl(url);
    // Rebuild from origin + pathname/search only (drop hash)
    const safeUrl = `${GITHUB_API_ORIGIN}${url.pathname}${url.search}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetchImpl(safeUrl, {
        method: req.method,
        redirect: 'error',
        signal: controller.signal,
        headers: {
          Accept: 'application/vnd.github+json',
          'Content-Type': 'application/json',
          'X-GitHub-Api-Version': '2022-11-28',
          ...(req.headers ?? {}),
        },
        body: req.body,
      });
      const headers: Record<string, string> = {};
      res.headers.forEach((v, k) => {
        headers[k.toLowerCase()] = v;
      });
      const body = await res.text();
      return { status: res.status, headers, body };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (/abort/i.test(msg)) {
        throw new GithubHttpError('timeout', 0, undefined, 'timeout');
      }
      throw new GithubHttpError(redactText(msg, 160), 0, undefined, 'transport_error');
    } finally {
      clearTimeout(timer);
    }
  };
}

/** Parse GitHub Link header; only returns next if same origin api.github.com. */
export function parseGithubNextLink(linkHeader: string | undefined): string | null {
  if (!linkHeader) return null;
  // <url>; rel="next", <url>; rel="last"
  const parts = linkHeader.split(',');
  for (const part of parts) {
    const m = part.match(/<([^>]+)>\s*;\s*rel="?next"?/i);
    if (!m?.[1]) continue;
    let nextUrl: URL;
    try {
      nextUrl = new URL(m[1]);
    } catch {
      throw new GithubHttpError('github_link_invalid', 400, undefined, 'pagination_invalid');
    }
    assertGithubApiUrl(nextUrl);
    if (!nextUrl.pathname.startsWith(`/repos/${ALLOWED_GITHUB_OWNER}/${ALLOWED_GITHUB_REPO}/issues`)) {
      throw new GithubHttpError('github_link_path_rejected', 400, undefined, 'pagination_invalid');
    }
    return `${nextUrl.pathname}${nextUrl.search}`;
  }
  return null;
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
      pull_request?: { url: string };
    }
  >();
  private seq = 0;
  readonly calls: GithubHttpRequest[] = [];
  script: Array<GithubHttpResponse | ((req: GithubHttpRequest) => GithubHttpResponse | Promise<GithubHttpResponse>)> =
    [];
  failNext?: GithubHttpResponse;
  createFlaky = false;
  private createAttempts = 0;
  /** Simulate POST that creates then times out before response reaches client */
  createSucceedsThenTimeout = false;
  /** Page size for list pagination tests */
  pageSize = 100;
  /** Max pages the fake will expose via Link (for incomplete tests) */
  maxFakePages?: number;
  /** Throw on Nth GET list */
  throwOnListCall?: number;
  private listCalls = 0;

  transport: GithubHttpTransport = async (req) => {
    // Validate pin rules even for fake (path/method)
    if (req.method !== 'GET' && req.method !== 'POST' && req.method !== 'PATCH') {
      return { status: 400, headers: {}, body: '{"message":"method"}' };
    }
    assertGithubIssuesPath(req.path);
    const sanitizedHeaders = { ...(req.headers ?? {}) };
    // Never retain Authorization in call log
    if (sanitizedHeaders.Authorization) sanitizedHeaders.Authorization = 'Bearer [redacted]';
    if (sanitizedHeaders.authorization) sanitizedHeaders.authorization = 'Bearer [redacted]';
    this.calls.push({ ...req, headers: sanitizedHeaders });

    if (this.failNext) {
      const r = this.failNext;
      this.failNext = undefined;
      return r;
    }
    if (this.script.length) {
      const next = this.script.shift()!;
      return typeof next === 'function' ? await next(req) : next;
    }
    return this.handle(req);
  };

  private handle(req: GithubHttpRequest): GithubHttpResponse {
    const url = new URL(req.path, GITHUB_API_ORIGIN);
    const path = url.pathname;

    if (req.method === 'GET' && /\/repos\/[^/]+\/[^/]+\/issues$/.test(path)) {
      this.listCalls += 1;
      if (this.throwOnListCall && this.listCalls === this.throwOnListCall) {
        throw new GithubHttpError('timeout', 0, undefined, 'timeout');
      }
      const state = url.searchParams.get('state') ?? 'open';
      const labels = (url.searchParams.get('labels') ?? '').split(',').filter(Boolean);
      const page = Math.max(1, Number(url.searchParams.get('page') || '1') || 1);
      // Cap by pageSize so offline pagination tests can force multi-page without changing client
      const requested =
        Number(url.searchParams.get('per_page') || String(this.pageSize)) || this.pageSize;
      const perPage = Math.min(100, Math.max(1, Math.min(requested, this.pageSize)));
      let list = [...this.issues.values()];
      if (state !== 'all') list = list.filter((i) => i.state === state);
      if (labels.length) {
        list = list.filter((i) => labels.every((l) => i.labels.includes(l)));
      }
      list.sort((a, b) => a.number - b.number);
      const start = (page - 1) * perPage;
      const slice = list.slice(start, start + perPage);
      const hasMore = start + perPage < list.length;
      const pageCap = this.maxFakePages ?? Number.POSITIVE_INFINITY;
      const allowNext = hasMore && page < pageCap;
      const headers: Record<string, string> = {};
      if (allowNext) {
        const nextPath = `${path}?${new URLSearchParams({
          state,
          labels: labels.join(','),
          per_page: String(perPage),
          page: String(page + 1),
        }).toString()}`;
        headers.link = `<${GITHUB_API_ORIGIN}${nextPath}>; rel="next"`;
      }
      return { status: 200, headers, body: JSON.stringify(slice) };
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
      if (this.createSucceedsThenTimeout) {
        throw new GithubHttpError('timeout', 0, undefined, 'timeout');
      }
      return { status: 201, headers: {}, body: JSON.stringify(issue) };
    }

    return { status: 404, headers: {}, body: JSON.stringify({ message: 'unhandled_fake_route' }) };
  }

  seedIssue(
    partial: Partial<{
      number: number;
      title: string;
      body: string;
      state: 'open' | 'closed';
      labels: string[];
      pull_request?: { url: string };
    }>,
  ) {
    this.seq = Math.max(this.seq, partial.number ?? this.seq + 1);
    const n = partial.number ?? ++this.seq;
    const now = new Date().toISOString();
    this.issues.set(n, {
      number: n,
      title: partial.title ?? `issue-${n}`,
      body: partial.body ?? '',
      state: partial.state ?? 'open',
      labels: partial.labels ?? [],
      created_at: now,
      updated_at: now,
      pull_request: partial.pull_request,
    });
    return n;
  }
}
