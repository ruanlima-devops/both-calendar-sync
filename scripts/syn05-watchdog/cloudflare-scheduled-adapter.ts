/**
 * Cloudflare Workers scheduled() adapter — INERT by default.
 *
 * - No side effects on import
 * - No network unless injectable transport explicitly used AND gate authorized
 * - No Supabase credentials accepted
 * - crons=[] in wrangler — this module never enables Cron
 * - Operational activation requires separate PO gate (not this E2E)
 */

import { STAGE_ENVIRONMENT, STAGE_PROJECT_REF } from './types.ts';
import { createGithubAppJwt, redactJwtLike } from './github-app-jwt.ts';
import {
  DEFAULT_EXTERNAL_OBSERVER_CONFIG,
  evaluateExternalObserver,
  type ExternalObserverConfig,
  type StatusSource,
} from './external-observer-foundation.ts';
import { createDisabledAlertSink, type AlertSink } from './alert-channel.ts';
import { redactText } from './redact.ts';

export const CF_OBSERVER_SCHEMA = 'both-syn05-cf-observer-adapter:v1' as const;
export const ALLOWED_GITHUB_API_HOST = 'api.github.com' as const;
export const ALLOWED_REPO = 'ruanlima-devops/both-calendar-sync' as const;

export type CfObserverEnv = {
  OBSERVER_AUTHORIZATION_GATE?: string;
  GITHUB_APP_ID?: string;
  GITHUB_INSTALLATION_ID?: string;
  GITHUB_APP_PRIVATE_KEY_PKCS8?: string;
  /** Must never be set for observer — rejected if present */
  SUPABASE_ACCESS_TOKEN?: string;
  SUPABASE_LOGS_READ_TOKEN?: string;
  BETTERSTACK_HEARTBEAT_A_URL?: string;
  EXPECTED_REPO?: string;
};

export type ScheduledControllerLike = {
  scheduledTime: number;
  cron: string;
  noRetry?: () => void;
};

export type CfScheduledResult = {
  schema_version: typeof CF_OBSERVER_SCHEMA;
  operationally_active: false;
  http_performed: boolean;
  heartbeat_sent: false;
  classification: string;
  reason_code: string;
  environment: typeof STAGE_ENVIRONMENT;
  project_ref: typeof STAGE_PROJECT_REF;
};

export type CfAdapterDeps = {
  fetchImpl?: typeof fetch;
  statusSource?: StatusSource | null;
  alertSink?: AlertSink;
  nowMs?: number;
  observerConfig?: ExternalObserverConfig;
};

function gateAuthorized(env: CfObserverEnv): boolean {
  return env.OBSERVER_AUTHORIZATION_GATE === 'PO_AUTHORIZED';
}

export function validateCfObserverEnv(
  env: CfObserverEnv,
): { ok: true } | { ok: false; code: string } {
  if (env.SUPABASE_ACCESS_TOKEN || env.SUPABASE_LOGS_READ_TOKEN) {
    return { ok: false, code: 'supabase_pat_forbidden_on_observer' };
  }
  if (env.EXPECTED_REPO && env.EXPECTED_REPO !== ALLOWED_REPO) {
    return { ok: false, code: 'unexpected_repo' };
  }
  if (env.BETTERSTACK_HEARTBEAT_A_URL) {
    // Presence alone must not activate — but URL must not be logged; validate shape only if present
    try {
      const u = new URL(env.BETTERSTACK_HEARTBEAT_A_URL);
      if (u.protocol !== 'https:') return { ok: false, code: 'heartbeat_url_insecure' };
    } catch {
      return { ok: false, code: 'heartbeat_url_invalid' };
    }
  }
  return { ok: true };
}

/**
 * Assert GitHub API URL is pinned to api.github.com HTTPS.
 */
export function assertGithubApiUrl(url: string): void {
  const u = new URL(url);
  if (u.protocol !== 'https:') throw new Error('github_https_required');
  if (u.hostname !== ALLOWED_GITHUB_API_HOST) throw new Error('github_host_not_allowlisted');
  if (u.username || u.password) throw new Error('github_url_userinfo_forbidden');
}

/**
 * Build a JWT for future installation-token exchange — network NOT performed here.
 */
export async function prepareGithubAppJwtFromEnv(
  env: CfObserverEnv,
  nowSeconds?: number,
): Promise<{ ok: true; token: string; exp: number } | { ok: false; code: string }> {
  if (!env.GITHUB_APP_ID) return { ok: false, code: 'app_id_absent' };
  if (!env.GITHUB_INSTALLATION_ID) return { ok: false, code: 'installation_id_absent' };
  if (!/^\d+$/.test(env.GITHUB_INSTALLATION_ID)) return { ok: false, code: 'installation_id_invalid' };
  if (!env.GITHUB_APP_PRIVATE_KEY_PKCS8) return { ok: false, code: 'private_key_absent' };

  const jwt = await createGithubAppJwt({
    app_id: env.GITHUB_APP_ID,
    private_key_pkcs8: env.GITHUB_APP_PRIVATE_KEY_PKCS8,
    now_seconds: nowSeconds,
  });
  if (!jwt.ok) return jwt;
  return { ok: true, token: jwt.token, exp: jwt.exp };
}

/**
 * Inert scheduled handler. Even if Cron were enabled later, this E2E keeps
 * operationally_active=false and never sends heartbeats / never writes Issues.
 */
export async function handleScheduledInert(
  _controller: ScheduledControllerLike,
  env: CfObserverEnv,
  deps: CfAdapterDeps = {},
): Promise<CfScheduledResult> {
  const nowMs = deps.nowMs ?? Date.now();
  const base = {
    schema_version: CF_OBSERVER_SCHEMA,
    operationally_active: false as const,
    heartbeat_sent: false as const,
    environment: STAGE_ENVIRONMENT,
    project_ref: STAGE_PROJECT_REF,
  };

  const envCheck = validateCfObserverEnv(env);
  if (!envCheck.ok) {
    return {
      ...base,
      http_performed: false,
      classification: 'CONFIG_INVALID',
      reason_code: envCheck.code,
    };
  }

  // Fail-closed: gate OFF → intentional disablement (never HEALTHY)
  if (!gateAuthorized(env)) {
    const cfg = deps.observerConfig ?? DEFAULT_EXTERNAL_OBSERVER_CONFIG;
    const evalResult = await evaluateExternalObserver({
      config: { ...cfg, enabled: false, authorization_gate: 'OFF' },
      nowMs,
      statusSource: null,
    });
    return {
      ...base,
      http_performed: false,
      classification: evalResult.health,
      reason_code: evalResult.reason_code,
    };
  }

  // Gate authorized in tests only — still no live network unless statusSource injected.
  // Never auto-fetch GitHub/Better Stack from env URLs in this inert adapter.
  if (deps.fetchImpl && env.BETTERSTACK_HEARTBEAT_A_URL) {
    // Explicitly refuse sending heartbeat in inert adapter
    void deps.fetchImpl;
    void redactJwtLike('eyJhbGciOiJSUzI1NiJ9.x.y');
  }

  const sink = deps.alertSink ?? createDisabledAlertSink();
  void sink;

  const evalResult = await evaluateExternalObserver({
    config: deps.observerConfig ?? {
      ...DEFAULT_EXTERNAL_OBSERVER_CONFIG,
      enabled: true,
      authorization_gate: 'PO_AUTHORIZED',
    },
    nowMs,
    statusSource: deps.statusSource ?? null,
  });

  return {
    ...base,
    http_performed: false,
    classification: evalResult.health,
    reason_code: redactText(evalResult.reason_code, 80),
  };
}

/**
 * Optional inert fetch stub — if platform requires an HTTP entrypoint.
 * Never authenticates, never activates observer, never reads secrets into response.
 */
export async function handleFetchInert(_req: Request): Promise<Response> {
  return new Response(
    JSON.stringify({
      service: 'both-stage-syn05-observer',
      status: 'inert',
      operationally_active: false,
      cron_enabled: false,
    }),
    {
      status: 200,
      headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
    },
  );
}

/** Cloudflare Worker entry shape — wired for local/typecheck; Cron empty in wrangler. */
export default {
  async scheduled(
    controller: ScheduledControllerLike,
    env: CfObserverEnv,
    _ctx?: unknown,
  ): Promise<void> {
    await handleScheduledInert(controller, env, {});
  },
  async fetch(req: Request): Promise<Response> {
    return handleFetchInert(req);
  },
};
