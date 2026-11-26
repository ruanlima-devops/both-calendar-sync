/**
 * Local-only OAuth HTTP shim for Playwright E2E.
 * Uses real oauth helpers + disposable Postgres + GoTrue JWT validation via /user.
 * Never bind to non-loopback. Never use remote DB.
 */
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { createPgDb, localPgUrl, type PgHarness } from '../../supabase/functions/_shared/testing/pg-db.ts';
import { stubDenoEnv } from '../../supabase/functions/_shared/testing/fake-db.ts';
import {
  clientNonceFromBody,
  createOAuthState,
  finalizeOAuthConnection,
  handleOAuthCallback,
  type OAuthProvider,
} from '../../supabase/functions/_shared/oauth.ts';
import { userFromAccessToken, type GoTrueSession } from './gotrue-client.ts';

const KEY = Buffer.from(new Uint8Array(32).fill(7)).toString('base64');
const APP = 'http://127.0.0.1:8791/oauth';

export type LocalOAuthShim = {
  baseUrl: string;
  harness: PgHarness;
  userA: string;
  userB: string;
  tokenA: string;
  tokenB: string;
  close: () => Promise<void>;
};

export type ShimUsers = {
  sessionA: GoTrueSession;
  sessionB: GoTrueSession;
};

function json(res: http.ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

function readBody(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(Buffer.from(c)));
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'));
      } catch {
        resolve({});
      }
    });
  });
}

async function userFromAuth(req: http.IncomingMessage): Promise<string | null> {
  const h = req.headers.authorization;
  if (!h?.startsWith('Bearer ')) return null;
  const token = h.slice('Bearer '.length).trim();
  if (!token || token.split('.').length < 3) return null; // require JWT shape
  const user = await userFromAccessToken(token);
  return user?.id ?? null;
}

export async function startLocalOAuthShim(
  mockProviderBase: string,
  users: ShimUsers,
): Promise<LocalOAuthShim> {
  const url = localPgUrl();
  if (!url) throw new Error('OAUTH_LOCAL_DATABASE_URL required');
  stubDenoEnv({ APP_URL: 'http://127.0.0.1:8791' });
  const harness = createPgDb(url);
  await harness.resetOAuthTables();
  const userA = users.sessionA.userId;
  const userB = users.sessionB.userId;
  await harness.pool.query('INSERT INTO public.profiles (id, display_name) VALUES ($1,$2), ($3,$4)', [
    userA,
    users.sessionA.email,
    userB,
    users.sessionB.email,
  ]);

  const server = http.createServer(async (req, res) => {
    const u = new URL(req.url || '/', 'http://127.0.0.1');
    try {
      if (u.pathname === '/health') return json(res, 200, { ok: true, auth: 'gotrue' });

      if (u.pathname === '/oauth' && req.method === 'GET') {
        const ticket = u.searchParams.get('oauth_ticket');
        const err = u.searchParams.get('oauth_error') || u.searchParams.get('error');
        const provider = u.searchParams.get('provider') || '';
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        res.end(`<!doctype html><html><body>
          <h1 id="oauth-landing">OAuth landing</h1>
          <div id="ticket">${ticket ?? ''}</div>
          <div id="error">${err ?? ''}</div>
          <div id="provider">${provider}</div>
        </body></html>`);
        return;
      }

      if (u.pathname === '/start' && req.method === 'POST') {
        const userId = await userFromAuth(req);
        if (!userId) return json(res, 401, { error: 'unauthorized' });
        const body = await readBody(req);
        const provider = String(body.provider || 'GOOGLE').toUpperCase() as OAuthProvider;
        const clientNonce = clientNonceFromBody(body);
        const state = await createOAuthState(harness.db, {
          userId,
          provider,
          verifier: 'local-pkce-verifier',
          redirect: APP,
          clientNonce,
        });
        const authPath = provider === 'GOOGLE' ? '/google/authorize' : '/microsoft/authorize';
        const authorizationUrl = `${mockProviderBase}${authPath}?response_type=code&state=${encodeURIComponent(state)}&redirect_uri=${encodeURIComponent(`http://127.0.0.1:${(server.address() as AddressInfo).port}/callback`)}&scenario=${encodeURIComponent(String(body.scenario || 'success'))}`;
        return json(res, 200, { authorizationUrl, state });
      }

      if (u.pathname === '/callback' && req.method === 'GET') {
        const providerParam = u.searchParams.get('provider');
        let provider: OAuthProvider = providerParam === 'microsoft' ? 'MICROSOFT' : 'GOOGLE';
        const state = u.searchParams.get('state') || '';
        if (state) {
          const { rows } = await harness.pool.query('SELECT provider FROM public.oauth_states WHERE state = $1', [
            state,
          ]);
          if (rows[0]?.provider === 'MICROSOFT' || rows[0]?.provider === 'GOOGLE') {
            provider = rows[0].provider;
          }
        }
        const response = await handleOAuthCallback(harness.db, {
          callback: {
            error: u.searchParams.get('error'),
            code: u.searchParams.get('code'),
            state,
          },
          provider,
          encryptionKey: KEY,
        });
        const location = response.headers.get('Location') || '/oauth';
        const loc = new URL(location, `http://127.0.0.1`);
        const port = (server.address() as AddressInfo).port;
        const local = new URL(`http://127.0.0.1:${port}/oauth`);
        loc.searchParams.forEach((v, k) => local.searchParams.set(k, v));
        res.writeHead(302, { Location: local.toString() });
        res.end();
        return;
      }

      if (u.pathname === '/finalize' && req.method === 'POST') {
        const userId = await userFromAuth(req);
        if (!userId) return json(res, 401, { error: 'unauthorized' });
        const body = await readBody(req);
        const provider = String(body.provider || 'GOOGLE').toUpperCase() as OAuthProvider;
        const result = await finalizeOAuthConnection(
          harness.db,
          { userId, provider, body, encryptionKey: KEY },
          async (ctx) => {
            await harness.pool.query(
              `INSERT INTO public.calendar_connections (user_id, provider, status, account_email)
               VALUES ($1, $2, 'CONNECTED', $3)`,
              [ctx.userId, ctx.provider, `${ctx.provider.toLowerCase()}@example.test`],
            );
          },
        );
        return json(res, result.status, result.ok ? { ok: true } : { error: result.error });
      }

      if (u.pathname === '/connections' && req.method === 'GET') {
        const userId = await userFromAuth(req);
        if (!userId) return json(res, 401, { error: 'unauthorized' });
        const { rows } = await harness.pool.query(
          'SELECT id, provider, status, account_email FROM public.calendar_connections WHERE user_id = $1',
          [userId],
        );
        return json(res, 200, { connections: rows });
      }

      json(res, 404, { error: 'not_found' });
    } catch (err) {
      json(res, 500, { error: err instanceof Error ? err.message : 'error' });
    }
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const port = (server.address() as AddressInfo).port;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    harness,
    userA,
    userB,
    tokenA: users.sessionA.accessToken,
    tokenB: users.sessionB.accessToken,
    close: async () => {
      await new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())));
      await harness.end();
    },
  };
}
