import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeDb, stubDenoEnv } from './testing/fake-db.ts';
import {
  consumeOAuthState,
  createOAuthState,
  defaultOAuthReturn,
  oauthCallbackParams,
  oauthCallbackRedirect,
  oauthCallbackRejection,
  type ConsumedOAuthState,
} from './oauth.ts';

const APP = 'http://localhost:8081/oauth?popup=1';
const TICKET = 'A'.repeat(43);
const NONCE = 'b'.repeat(64);

beforeEach(() => {
  stubDenoEnv({ APP_URL: 'https://app.example.test' });
  vi.spyOn(console, 'log').mockImplementation(() => {});
});

function session(overrides: Partial<ConsumedOAuthState> = {}): ConsumedOAuthState {
  return { id: 's1', userId: 'u1', verifier: 'v', redirect: APP, provider: 'GOOGLE', ...overrides };
}

describe('oauthCallbackRedirect', () => {
  it.each(['google', 'microsoft'] as const)('%s success redirects to the app instead of rendering HTML', async (provider) => {
    const res = oauthCallbackRedirect({ provider, redirectTo: APP, ticket: TICKET });
    expect(res.status).toBe(302);
    expect(res.headers.get('Location')).toBe(`${APP}&oauth_ticket=${TICKET}&provider=${provider}`);
    expect(res.headers.get('Content-Type')).toBeNull();
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(await res.text()).toBe('');
  });

  it('carries only a safe error code on failure', () => {
    const res = oauthCallbackRedirect({ provider: 'microsoft', redirectTo: 'http://localhost:8081/oauth', error: 'invalid_state' });
    expect(res.status).toBe(302);
    expect(res.headers.get('Location')).toBe('http://localhost:8081/oauth?oauth_error=invalid_state&provider=microsoft');
  });

  it.each([
    'both-stg://oauth',
    'exp://192.168.0.10:8081/--/oauth',
    'https://app.example.test/oauth',
  ])('redirects native and hosted returns too (%s)', (redirectTo) => {
    const res = oauthCallbackRedirect({ provider: 'google', redirectTo, ticket: TICKET });
    expect(res.status).toBe(302);
    expect(res.headers.get('Location')).toBe(`${redirectTo}?oauth_ticket=${TICKET}&provider=google`);
  });

  it('never leaks code or state into the app URL', () => {
    const location = oauthCallbackRedirect({ provider: 'google', redirectTo: APP, ticket: TICKET }).headers.get('Location')!;
    expect(location).not.toMatch(/[?&]code=|state=|access_token|refresh_token|verifier|nonce/);
  });

  it('falls back to the app /oauth route when the state (and its redirect) is unknown', () => {
    expect(defaultOAuthReturn()).toBe('https://app.example.test/oauth');
    stubDenoEnv({ APP_URL: 'http://localhost:8081/' });
    expect(defaultOAuthReturn()).toBe('http://localhost:8081/oauth');
  });
});

describe('oauthCallbackParams', () => {
  it('treats the POST start request as not a callback', () => {
    expect(oauthCallbackParams(new URL('https://x.test/functions/v1/google-oauth'))).toBeNull();
  });

  it('treats a state-only return as a callback (was a raw 401 JSON before)', () => {
    expect(oauthCallbackParams(new URL('https://x.test/f?state=abc'))).toEqual({ error: null, code: null, state: 'abc' });
  });

  it('parses provider error and code', () => {
    expect(oauthCallbackParams(new URL('https://x.test/f?error=access_denied'))).toEqual({ error: 'access_denied', code: null, state: '' });
    expect(oauthCallbackParams(new URL('https://x.test/f?code=c&state=s'))).toEqual({ error: null, code: 'c', state: 's' });
  });
});

describe('oauthCallbackRejection', () => {
  it('maps consent cancel, provider errors, bad state and missing code', () => {
    expect(oauthCallbackRejection({ error: 'access_denied', code: null, state: 's' }, session())).toBe('access_denied');
    expect(oauthCallbackRejection({ error: 'server_error', code: null, state: 's' }, session())).toBe('provider_error');
    expect(oauthCallbackRejection({ error: null, code: 'c', state: 'bad' }, null)).toBe('invalid_state');
    expect(oauthCallbackRejection({ error: null, code: null, state: 's' }, session())).toBe('missing_code');
    expect(oauthCallbackRejection({ error: null, code: 'c', state: 's' }, session())).toBeNull();
  });
});

describe('oauth state lifecycle', () => {
  it('binds state to user, provider, verifier and a 10 minute expiry, pruning expired rows', async () => {
    const { db, tables } = createFakeDb({
      oauth_states: [
        { id: 'old', user_id: 'u1', state: 'old', expires_at: '2000-01-01T00:00:00.000Z' },
        { id: 'other', user_id: 'u2', state: 'other', expires_at: '2000-01-01T00:00:00.000Z' },
      ],
    });
    const state = await createOAuthState(db, { userId: 'u1', provider: 'GOOGLE', verifier: 'ver', redirect: APP, clientNonce: NONCE });
    expect(state).toMatch(/^[0-9a-f]{64}$/);
    const row = tables.oauth_states.find((r) => r.state === state)!;
    expect(row).toMatchObject({ user_id: 'u1', provider: 'GOOGLE', code_verifier: 'ver', redirect_to: APP });
    const ttl = new Date(String(row.expires_at)).getTime() - Date.now();
    expect(ttl).toBeGreaterThan(9 * 60_000);
    expect(ttl).toBeLessThanOrEqual(10 * 60_000);
    expect(tables.oauth_states.some((r) => r.id === 'old')).toBe(false);
    expect(tables.oauth_states.some((r) => r.id === 'other')).toBe(true);
  });

  it('consumes a valid state once; a repeated callback is rejected', async () => {
    const { db, tables } = createFakeDb();
    const state = await createOAuthState(db, { userId: 'u1', provider: 'MICROSOFT', verifier: 'ver', redirect: APP, clientNonce: NONCE });
    const first = await consumeOAuthState(db, state, 'MICROSOFT');
    expect(first).toMatchObject({ userId: 'u1', verifier: 'ver', redirect: APP, provider: 'MICROSOFT' });
    expect(tables.oauth_states).toHaveLength(0);
    await expect(consumeOAuthState(db, state, 'MICROSOFT')).resolves.toBeNull();
  });

  it('rejects missing, unknown, expired, used and cross-provider states', async () => {
    const future = new Date(Date.now() + 60_000).toISOString();
    const { db, tables } = createFakeDb({
      oauth_states: [
        { id: '1', user_id: 'u1', provider: 'GOOGLE', state: 'expired', code_verifier: 'v', expires_at: '2000-01-01T00:00:00.000Z' },
        { id: '2', user_id: 'u1', provider: 'GOOGLE', state: 'used', code_verifier: 'v', expires_at: future, used_at: future },
        { id: '3', user_id: 'u1', provider: 'GOOGLE', state: 'google-only', code_verifier: 'v', expires_at: future },
      ],
    });
    await expect(consumeOAuthState(db, '', 'GOOGLE')).resolves.toBeNull();
    await expect(consumeOAuthState(db, 'nope', 'GOOGLE')).resolves.toBeNull();
    await expect(consumeOAuthState(db, 'expired', 'GOOGLE')).resolves.toBeNull();
    await expect(consumeOAuthState(db, 'used', 'GOOGLE')).resolves.toBeNull();
    await expect(consumeOAuthState(db, 'google-only', 'MICROSOFT')).resolves.toBeNull();
    expect(tables.oauth_states.find((r) => r.state === 'google-only')).toBeDefined();
  });
});
