import { beforeEach, describe, expect, it, vi } from 'vitest';
import { decryptSecret, sha256Hex } from './crypto/tokens.ts';
import { createFakeDb, stubDenoEnv } from './testing/fake-db.ts';
import {
  clientNonceFromBody,
  createOAuthState,
  finalizeOAuthConnection,
  handleOAuthCallback,
  type CompletionContext,
  type OAuthProvider,
} from './oauth.ts';

const APP = 'http://localhost:8081/oauth?popup=1';
const KEY = Buffer.from(new Uint8Array(32).fill(7)).toString('base64');
const NONCE_A = 'a1'.repeat(32);
const NONCE_OTHER = 'c3'.repeat(32);
const CODE = 'provider-auth-code-4/0AbCdEf';
const USER_A = 'user-a';
const USER_B = 'user-b';

beforeEach(() => {
  stubDenoEnv({ APP_URL: 'https://app.example.test' });
  vi.spyOn(console, 'log').mockImplementation(() => {});
});

/** User A starts OAuth for `provider`; the provider redirects back with a code. */
async function startAndCallback(provider: OAuthProvider = 'GOOGLE') {
  const existingB = { id: 'conn-b', user_id: USER_B, provider, status: 'CONNECTED', account_email: 'b@example.test' };
  const fake = createFakeDb({ calendar_connections: [existingB] });
  const state = await createOAuthState(fake.db, {
    userId: USER_A,
    provider,
    verifier: 'pkce-verifier-a',
    redirect: APP,
    clientNonce: NONCE_A,
  });
  const res = await handleOAuthCallback(fake.db, {
    callback: { error: null, code: CODE, state },
    provider,
    encryptionKey: KEY,
  });
  const location = new URL(res.headers.get('Location')!);
  const ticket = location.searchParams.get('oauth_ticket')!;
  const connectionsBefore = structuredClone(fake.tables.calendar_connections);
  return { ...fake, state, res, location, ticket, connectionsBefore };
}

function finalize(
  db: Parameters<typeof finalizeOAuthConnection>[0],
  input: { userId: string; provider?: OAuthProvider; ticket: unknown; nonce: unknown },
) {
  const complete = vi.fn(async (_ctx: CompletionContext) => {});
  const result = finalizeOAuthConnection(
    db,
    {
      userId: input.userId,
      provider: input.provider ?? 'GOOGLE',
      body: { action: 'finalize', ticket: input.ticket, client_nonce: input.nonce },
      encryptionKey: KEY,
    },
    complete,
  );
  return { result, complete };
}

describe('client nonce binding at OAuth start', () => {
  it('requires a nonce of at least 128 bits', () => {
    expect(() => clientNonceFromBody({})).toThrow('invalid_client_nonce');
    expect(() => clientNonceFromBody({ client_nonce: 'short' })).toThrow('invalid_client_nonce');
    expect(() => clientNonceFromBody({ client_nonce: 'x'.repeat(21) })).toThrow('invalid_client_nonce');
    expect(clientNonceFromBody({ client_nonce: NONCE_A })).toBe(NONCE_A);
  });

  it('stores only SHA-256(client_nonce) with the state, never the nonce', async () => {
    const { db, tables } = createFakeDb();
    await createOAuthState(db, { userId: USER_A, provider: 'GOOGLE', verifier: 'v', redirect: APP, clientNonce: NONCE_A });
    const row = tables.oauth_states[0]!;
    expect(row.client_nonce_hash).toBe(await sha256Hex(NONCE_A));
    expect(JSON.stringify(row)).not.toContain(NONCE_A);
  });
});

describe('provider callback issues a completion ticket only', () => {
  it.each(['GOOGLE', 'MICROSOFT'] as const)('%s: 302 with an opaque ticket; no code, verifier or nonce in Location', async (provider) => {
    const { res, location, ticket } = await startAndCallback(provider);
    expect(res.status).toBe(302);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(ticket).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(location.searchParams.get('provider')).toBe(provider.toLowerCase());
    const href = location.toString();
    expect(href).not.toContain(CODE);
    expect(href).not.toContain('pkce-verifier-a');
    expect(href).not.toContain(NONCE_A);
    expect(href).not.toMatch(/[?&](code|state|access_token|refresh_token)=/);
  });

  it('never creates or updates connections; keeps only hashes and the encrypted code', async () => {
    const { tables, ticket, connectionsBefore } = await startAndCallback();
    expect(tables.calendar_connections).toEqual(connectionsBefore);
    expect(tables.calendar_secrets).toBeUndefined();
    expect(tables.webhook_subscriptions).toBeUndefined();
    const row = tables.oauth_states[0]!;
    expect(row.used_at).toBeTruthy();
    expect(row.ticket_hash).toBe(await sha256Hex(ticket));
    expect(JSON.stringify(row)).not.toContain(ticket);
    expect(JSON.stringify(row)).not.toContain(CODE);
    expect(await decryptSecret(String(row.encrypted_code), KEY)).toBe(CODE);
    const ttl = new Date(String(row.ticket_expires_at)).getTime() - Date.now();
    expect(ttl).toBeGreaterThan(4 * 60_000);
    expect(ttl).toBeLessThanOrEqual(5 * 60_000);
  });

  it('a repeated callback for the same state cannot mint a second ticket', async () => {
    const { db, state } = await startAndCallback();
    const again = await handleOAuthCallback(db, { callback: { error: null, code: CODE, state }, provider: 'GOOGLE', encryptionKey: KEY });
    const location = new URL(again.headers.get('Location')!);
    expect(location.searchParams.get('oauth_ticket')).toBeNull();
    expect(location.searchParams.get('oauth_error')).toBe('invalid_state');
  });

  it.each(['GOOGLE', 'MICROSOFT'] as const)('%s cancel burns the state and issues no ticket', async (provider) => {
    const { db, tables } = createFakeDb();
    const state = await createOAuthState(db, { userId: USER_A, provider, verifier: 'v', redirect: APP, clientNonce: NONCE_A });
    const res = await handleOAuthCallback(db, { callback: { error: 'access_denied', code: null, state }, provider, encryptionKey: KEY });
    const location = new URL(res.headers.get('Location')!);
    expect(location.searchParams.get('oauth_error')).toBe('access_denied');
    expect(location.searchParams.get('oauth_ticket')).toBeNull();
    expect(tables.oauth_states).toHaveLength(0);
  });

  it('refuses states created without a client nonce binding', async () => {
    const future = new Date(Date.now() + 60_000).toISOString();
    const { db, tables } = createFakeDb({
      oauth_states: [{ id: 'legacy', user_id: USER_A, provider: 'GOOGLE', state: 'legacy', code_verifier: 'v', redirect_to: APP, expires_at: future }],
    });
    const res = await handleOAuthCallback(db, { callback: { error: null, code: CODE, state: 'legacy' }, provider: 'GOOGLE', encryptionKey: KEY });
    expect(new URL(res.headers.get('Location')!).searchParams.get('oauth_error')).toBe('invalid_state');
    expect(tables.oauth_states).toHaveLength(0);
  });
});

describe('authenticated finalize — cross-user attacks', () => {
  it('ATTACK A: user B with A\'s ticket and A\'s nonce is denied; nothing is connected and the ticket is burnt', async () => {
    const { db, tables, ticket, connectionsBefore } = await startAndCallback();
    const attempt = finalize(db, { userId: USER_B, ticket, nonce: NONCE_A });
    await expect(attempt.result).resolves.toEqual({ ok: false, status: 403, error: 'invalid_ticket' });
    expect(attempt.complete).not.toHaveBeenCalled();
    expect(tables.calendar_connections).toEqual(connectionsBefore);
    const retry = finalize(db, { userId: USER_A, ticket, nonce: NONCE_A });
    await expect(retry.result).resolves.toMatchObject({ ok: false, error: 'invalid_ticket' });
    expect(retry.complete).not.toHaveBeenCalled();
  });

  it('ATTACK B: same user from another browser (wrong or missing nonce) is denied', async () => {
    for (const nonce of [NONCE_OTHER, undefined, '', 'short']) {
      const { db, tables, ticket, connectionsBefore } = await startAndCallback();
      const attempt = finalize(db, { userId: USER_A, ticket, nonce });
      await expect(attempt.result).resolves.toMatchObject({ ok: false, status: 403, error: 'invalid_ticket' });
      expect(attempt.complete).not.toHaveBeenCalled();
      expect(tables.calendar_connections).toEqual(connectionsBefore);
    }
  });

  it('ATTACK C: a valid ticket works once; the second use fails', async () => {
    const { db, ticket } = await startAndCallback();
    const first = finalize(db, { userId: USER_A, ticket, nonce: NONCE_A });
    await expect(first.result).resolves.toEqual({ ok: true, status: 200 });
    expect(first.complete).toHaveBeenCalledTimes(1);
    const second = finalize(db, { userId: USER_A, ticket, nonce: NONCE_A });
    await expect(second.result).resolves.toMatchObject({ ok: false, status: 403 });
    expect(second.complete).not.toHaveBeenCalled();
  });

  it('ATTACK C (concurrent): two simultaneous redemptions complete at most once', async () => {
    const { db, ticket } = await startAndCallback();
    const a = finalize(db, { userId: USER_A, ticket, nonce: NONCE_A });
    const b = finalize(db, { userId: USER_A, ticket, nonce: NONCE_A });
    const results = await Promise.all([a.result, b.result]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(a.complete.mock.calls.length + b.complete.mock.calls.length).toBe(1);
  });

  it('ATTACK D: an expired ticket is denied', async () => {
    const { db, tables, ticket } = await startAndCallback();
    tables.oauth_states[0]!.ticket_expires_at = new Date(Date.now() - 1000).toISOString();
    const attempt = finalize(db, { userId: USER_A, ticket, nonce: NONCE_A });
    await expect(attempt.result).resolves.toMatchObject({ ok: false, status: 403 });
    expect(attempt.complete).not.toHaveBeenCalled();
  });

  it('ATTACK E: a Google ticket cannot be finalized as Microsoft (and vice versa)', async () => {
    const google = await startAndCallback('GOOGLE');
    const asMicrosoft = finalize(google.db, { userId: USER_A, provider: 'MICROSOFT', ticket: google.ticket, nonce: NONCE_A });
    await expect(asMicrosoft.result).resolves.toMatchObject({ ok: false, status: 403 });
    expect(asMicrosoft.complete).not.toHaveBeenCalled();

    const microsoft = await startAndCallback('MICROSOFT');
    const asGoogle = finalize(microsoft.db, { userId: USER_A, provider: 'GOOGLE', ticket: microsoft.ticket, nonce: NONCE_A });
    await expect(asGoogle.result).resolves.toMatchObject({ ok: false, status: 403 });
    expect(asGoogle.complete).not.toHaveBeenCalled();
  });

  it('ATTACK F: unknown, malformed or missing tickets are denied', async () => {
    const { db, tables } = await startAndCallback();
    for (const ticket of ['Z'.repeat(43), 'not-a-ticket', '', undefined, 42, tables.oauth_states[0]!.ticket_hash]) {
      const attempt = finalize(db, { userId: USER_A, ticket, nonce: NONCE_A });
      await expect(attempt.result).resolves.toMatchObject({ ok: false, status: 403, error: 'invalid_ticket' });
      expect(attempt.complete).not.toHaveBeenCalled();
    }
    expect(tables.oauth_states).toHaveLength(1);
  });

  it.each(['GOOGLE', 'MICROSOFT'] as const)('ATTACK G (%s): same user + same browser nonce + valid ticket connects', async (provider) => {
    const { db, tables, ticket } = await startAndCallback(provider);
    const attempt = finalize(db, { userId: USER_A, provider, ticket, nonce: NONCE_A });
    await expect(attempt.result).resolves.toEqual({ ok: true, status: 200 });
    expect(attempt.complete).toHaveBeenCalledWith({
      userId: USER_A,
      provider,
      verifier: 'pkce-verifier-a',
      code: CODE,
    });
    expect(tables.oauth_states).toHaveLength(0);
  });

  it('a failed exchange after a valid binding reports token_exchange_failed and cannot be retried', async () => {
    const { db, ticket } = await startAndCallback();
    const failing = finalizeOAuthConnection(
      db,
      { userId: USER_A, provider: 'GOOGLE', body: { ticket, client_nonce: NONCE_A }, encryptionKey: KEY },
      async () => { throw new Error('invalid_grant'); },
    );
    await expect(failing).resolves.toEqual({ ok: false, status: 502, error: 'token_exchange_failed' });
    const retry = finalize(db, { userId: USER_A, ticket, nonce: NONCE_A });
    await expect(retry.result).resolves.toMatchObject({ ok: false, status: 403 });
  });
});
