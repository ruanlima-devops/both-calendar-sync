/**
 * Real PostgreSQL integration for M3-003 OAuth lifecycle.
 * Requires disposable local DB (see scripts/oauth-local/schema.sql).
 * Skips when OAUTH_LOCAL_DATABASE_URL is unset — never invents PASS.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { sha256Hex } from './crypto/tokens.ts';
import { createPgDb, localPgUrl, type PgHarness } from './testing/pg-db.ts';
import { stubDenoEnv } from './testing/fake-db.ts';
import {
  createOAuthState,
  finalizeOAuthConnection,
  handleOAuthCallback,
  TICKET_TTL_MS,
  type OAuthProvider,
} from './oauth.ts';

const APP = 'http://localhost:8081/oauth?popup=1';
const KEY = Buffer.from(new Uint8Array(32).fill(7)).toString('base64');
const NONCE_A = 'a1'.repeat(32);
const NONCE_OTHER = 'c3'.repeat(32);
const CODE = 'provider-auth-code-local-e2e';

const pgUrl = (() => {
  try {
    return localPgUrl();
  } catch (err) {
    console.error(err);
    return null;
  }
})();

const describePg = pgUrl ? describe : describe.skip;

describePg('OAuth Postgres integration (local disposable)', () => {
  let harness: PgHarness;
  let USER_A: string;
  let USER_B: string;

  beforeAll(async () => {
    harness = createPgDb(pgUrl!);
    await harness.pool.query('SELECT 1');
  });

  afterAll(async () => {
    await harness?.end();
  });

  beforeEach(async () => {
    stubDenoEnv({ APP_URL: 'https://app.example.test' });
    vi.spyOn(console, 'log').mockImplementation(() => {});
    await harness.resetOAuthTables();
    USER_A = randomUUID();
    USER_B = randomUUID();
    await harness.pool.query('INSERT INTO public.profiles (id) VALUES ($1), ($2)', [USER_A, USER_B]);
  });

  async function startAndCallback(provider: OAuthProvider = 'GOOGLE') {
    const state = await createOAuthState(harness.db, {
      userId: USER_A,
      provider,
      verifier: 'pkce-verifier-a',
      redirect: APP,
      clientNonce: NONCE_A,
    });
    const res = await handleOAuthCallback(harness.db, {
      callback: { error: null, code: CODE, state },
      provider,
      encryptionKey: KEY,
    });
    expect(res.status).toBe(302);
    const location = new URL(String(res.headers.get('Location')));
    const ticket = location.searchParams.get('oauth_ticket');
    expect(ticket).toBeTruthy();
    return { state, ticket: ticket!, location };
  }

  function finalize(
    input: { userId: string; provider?: OAuthProvider; ticket: unknown; nonce: unknown },
  ) {
    const complete = vi.fn(async () => {});
    const result = finalizeOAuthConnection(
      harness.db,
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

  it('persists oauth state with user/provider/nonce hash binding', async () => {
    const state = await createOAuthState(harness.db, {
      userId: USER_A,
      provider: 'GOOGLE',
      verifier: 'v',
      redirect: APP,
      clientNonce: NONCE_A,
    });
    const { rows } = await harness.pool.query('SELECT * FROM public.oauth_states WHERE state = $1', [state]);
    expect(rows).toHaveLength(1);
    expect(rows[0].user_id).toBe(USER_A);
    expect(rows[0].provider).toBe('GOOGLE');
    expect(rows[0].client_nonce_hash).toBe(await sha256Hex(NONCE_A));
    expect(String(rows[0].client_nonce_hash)).not.toContain(NONCE_A.slice(0, 8));
  });

  it('rejects missing and expired state on callback', async () => {
    const missing = await handleOAuthCallback(harness.db, {
      callback: { error: null, code: CODE, state: 'nope' },
      provider: 'GOOGLE',
      encryptionKey: KEY,
    });
    expect(new URL(String(missing.headers.get('Location'))).searchParams.get('oauth_ticket')).toBeNull();

    const state = await createOAuthState(harness.db, {
      userId: USER_A,
      provider: 'GOOGLE',
      verifier: 'v',
      redirect: APP,
      clientNonce: NONCE_A,
    });
    await harness.pool.query('UPDATE public.oauth_states SET expires_at = now() - interval \'1 minute\' WHERE state = $1', [
      state,
    ]);
    const expired = await handleOAuthCallback(harness.db, {
      callback: { error: null, code: CODE, state },
      provider: 'GOOGLE',
      encryptionKey: KEY,
    });
    expect(new URL(String(expired.headers.get('Location'))).searchParams.get('oauth_ticket')).toBeNull();
  });

  it('callback issues opaque ticket without creating connections', async () => {
    const { ticket, location } = await startAndCallback('GOOGLE');
    expect(ticket).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(location.searchParams.get('code')).toBeNull();
    expect(location.href).not.toContain(CODE);
    const { rows } = await harness.pool.query('SELECT ticket_hash, encrypted_code, ticket_expires_at FROM public.oauth_states');
    expect(rows).toHaveLength(1);
    expect(rows[0].ticket_hash).toBe(await sha256Hex(ticket));
    expect(JSON.stringify(rows[0])).not.toContain(ticket);
    const ttl = new Date(rows[0].ticket_expires_at).getTime() - Date.now();
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(TICKET_TTL_MS + 5_000);
    const cons = await harness.pool.query('SELECT count(*)::int AS c FROM public.calendar_connections');
    expect(cons.rows[0].c).toBe(0);
  });

  it('enforces ticket_complete constraint', async () => {
    await expect(
      harness.pool.query(
        `INSERT INTO public.oauth_states
         (user_id, provider, state, code_verifier, expires_at, ticket_hash, client_nonce_hash)
         VALUES ($1,'GOOGLE','s1','v', now() + interval '5 minutes', 'hash', 'nonce')`,
        [USER_A],
      ),
    ).rejects.toThrow(/oauth_states_ticket_complete/);
  });

  it('ATTACK A: cross-user finalize denied and ticket burnt', async () => {
    const { ticket } = await startAndCallback();
    const attempt = finalize({ userId: USER_B, ticket, nonce: NONCE_A });
    await expect(attempt.result).resolves.toEqual({ ok: false, status: 403, error: 'invalid_ticket' });
    expect(attempt.complete).not.toHaveBeenCalled();
    const retry = finalize({ userId: USER_A, ticket, nonce: NONCE_A });
    await expect(retry.result).resolves.toMatchObject({ ok: false, error: 'invalid_ticket' });
  });

  it('ATTACK B: wrong browser nonce denied', async () => {
    for (const nonce of [NONCE_OTHER, undefined, '', 'short']) {
      await harness.resetOAuthTables();
      await harness.pool.query('INSERT INTO public.profiles (id) VALUES ($1), ($2)', [USER_A, USER_B]);
      const { ticket } = await startAndCallback();
      const attempt = finalize({ userId: USER_A, ticket, nonce });
      await expect(attempt.result).resolves.toMatchObject({ ok: false, status: 403 });
      expect(attempt.complete).not.toHaveBeenCalled();
    }
  });

  it('ATTACK C: ticket single-use + concurrent redemptions ≤1 winner', async () => {
    const { ticket } = await startAndCallback();
    const first = finalize({ userId: USER_A, ticket, nonce: NONCE_A });
    await expect(first.result).resolves.toEqual({ ok: true, status: 200 });
    const second = finalize({ userId: USER_A, ticket, nonce: NONCE_A });
    await expect(second.result).resolves.toMatchObject({ ok: false, status: 403 });

    const { ticket: t2 } = await startAndCallback();
    const a = finalize({ userId: USER_A, ticket: t2, nonce: NONCE_A });
    const b = finalize({ userId: USER_A, ticket: t2, nonce: NONCE_A });
    const results = await Promise.all([a.result, b.result]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(a.complete.mock.calls.length + b.complete.mock.calls.length).toBe(1);
  });

  it('ATTACK C-5: five concurrent finalize calls yield exactly one success', async () => {
    const { ticket } = await startAndCallback();
    const attempts = Array.from({ length: 5 }, () => finalize({ userId: USER_A, ticket, nonce: NONCE_A }));
    const results = await Promise.all(attempts.map((a) => a.result));
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(attempts.reduce((n, a) => n + a.complete.mock.calls.length, 0)).toBe(1);
  });

  it('ATTACK D: expired ticket denied', async () => {
    const { ticket } = await startAndCallback();
    await harness.pool.query(
      `UPDATE public.oauth_states SET ticket_expires_at = now() - interval '1 second', expires_at = now() - interval '1 second'`,
    );
    const attempt = finalize({ userId: USER_A, ticket, nonce: NONCE_A });
    await expect(attempt.result).resolves.toMatchObject({ ok: false, status: 403 });
    expect(attempt.complete).not.toHaveBeenCalled();
  });

  it('ATTACK E: provider mismatch denied', async () => {
    const google = await startAndCallback('GOOGLE');
    const asMs = finalize({
      userId: USER_A,
      provider: 'MICROSOFT',
      ticket: google.ticket,
      nonce: NONCE_A,
    });
    await expect(asMs.result).resolves.toMatchObject({ ok: false, status: 403 });
  });

  it('ATTACK F: malformed tickets denied', async () => {
    await startAndCallback();
    for (const ticket of ['Z'.repeat(43), 'not-a-ticket', '', undefined, 42]) {
      const attempt = finalize({ userId: USER_A, ticket, nonce: NONCE_A });
      await expect(attempt.result).resolves.toMatchObject({ ok: false, status: 403, error: 'invalid_ticket' });
    }
  });

  it('ATTACK G: matching user+nonce+provider connects once', async () => {
    for (const provider of ['GOOGLE', 'MICROSOFT'] as const) {
      await harness.resetOAuthTables();
      await harness.pool.query('INSERT INTO public.profiles (id) VALUES ($1)', [USER_A]);
      const { ticket } = await startAndCallback(provider);
      const attempt = finalize({ userId: USER_A, provider, ticket, nonce: NONCE_A });
      await expect(attempt.result).resolves.toEqual({ ok: true, status: 200 });
      expect(attempt.complete).toHaveBeenCalledWith(
        expect.objectContaining({ userId: USER_A, provider, code: CODE }),
      );
      const left = await harness.pool.query('SELECT count(*)::int AS c FROM public.oauth_states');
      expect(left.rows[0].c).toBe(0);
    }
  });

  it('duplicate callback cannot mint a second ticket', async () => {
    const { state } = await startAndCallback();
    const again = await handleOAuthCallback(harness.db, {
      callback: { error: null, code: CODE, state },
      provider: 'GOOGLE',
      encryptionKey: KEY,
    });
    expect(new URL(String(again.headers.get('Location'))).searchParams.get('oauth_ticket')).toBeNull();
  });

  it('two concurrent OAuth flows for different users stay isolated', async () => {
    const stateA = await createOAuthState(harness.db, {
      userId: USER_A,
      provider: 'GOOGLE',
      verifier: 'va',
      redirect: APP,
      clientNonce: NONCE_A,
    });
    const stateB = await createOAuthState(harness.db, {
      userId: USER_B,
      provider: 'MICROSOFT',
      verifier: 'vb',
      redirect: APP,
      clientNonce: NONCE_OTHER,
    });
    const [cbA, cbB] = await Promise.all([
      handleOAuthCallback(harness.db, {
        callback: { error: null, code: 'code-a', state: stateA },
        provider: 'GOOGLE',
        encryptionKey: KEY,
      }),
      handleOAuthCallback(harness.db, {
        callback: { error: null, code: 'code-b', state: stateB },
        provider: 'MICROSOFT',
        encryptionKey: KEY,
      }),
    ]);
    const ticketA = new URL(String(cbA.headers.get('Location'))).searchParams.get('oauth_ticket')!;
    const ticketB = new URL(String(cbB.headers.get('Location'))).searchParams.get('oauth_ticket')!;
    expect(ticketA).not.toBe(ticketB);

    const cross = finalize({ userId: USER_B, provider: 'GOOGLE', ticket: ticketA, nonce: NONCE_A });
    await expect(cross.result).resolves.toMatchObject({ ok: false });

    const okB = finalize({ userId: USER_B, provider: 'MICROSOFT', ticket: ticketB, nonce: NONCE_OTHER });
    await expect(okB.result).resolves.toEqual({ ok: true, status: 200 });
  });
});
