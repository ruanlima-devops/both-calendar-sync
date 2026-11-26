/**
 * Playwright E2E: GoTrue real JWT + mock Google/Microsoft + OAuth shim + disposable Postgres.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer } from 'node:http';
import { spawn, type ChildProcess } from 'node:child_process';
import { chromium, type Browser, type Page } from 'playwright';
import { encodeClientNonce } from '../../lib/oauth-complete.ts';
import { localPgUrl } from '../../supabase/functions/_shared/testing/pg-db.ts';
import { startLocalOAuthShim, type LocalOAuthShim } from '../../scripts/oauth-local/local-oauth-shim.ts';
import { goTrueHealth, signup } from '../../scripts/oauth-local/gotrue-client.ts';

const pgReady = (() => {
  try {
    return Boolean(localPgUrl());
  } catch {
    return false;
  }
})();

const describeE2E = pgReady ? describe : describe.skip;

describeE2E('Playwright OAuth E2E (GoTrue JWT + mock providers)', () => {
  let mockProc: ChildProcess;
  let mockPort = 0;
  let shim: LocalOAuthShim;
  let browser: Browser;
  let goTrueOk = false;

  beforeAll(async () => {
    goTrueOk = await goTrueHealth();
    if (!goTrueOk) throw new Error('GoTrue not healthy on 127.0.0.1:9999 — run scripts/oauth-local/start-gotrue.sh');

    mockPort = await new Promise<number>((resolve, reject) => {
      const s = createServer();
      s.listen(0, '127.0.0.1', () => {
        const p = (s.address() as { port: number }).port;
        s.close(() => resolve(p));
      });
      s.on('error', reject);
    });
    mockProc = spawn(process.execPath, ['scripts/oauth-local/mock-providers.mjs'], {
      cwd: process.cwd(),
      env: { ...process.env, OAUTH_MOCK_PORT: String(mockPort) },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('mock providers timeout')), 10_000);
      mockProc.stdout?.on('data', (buf) => {
        if (String(buf).includes('mock_providers')) {
          clearTimeout(t);
          resolve();
        }
      });
      mockProc.on('exit', (code) => reject(new Error(`mock exited ${code}`)));
    });

    const stamp = Date.now();
    const sessionA = await signup(`pw-a-${stamp}@example.test`, 'LocalTestPass-A-9x!');
    const sessionB = await signup(`pw-b-${stamp}@example.test`, 'LocalTestPass-B-9x!');
    shim = await startLocalOAuthShim(`http://127.0.0.1:${mockPort}`, { sessionA, sessionB });
    browser = await chromium.launch({ headless: true });
  }, 90_000);

  afterAll(async () => {
    await browser?.close();
    await shim?.close();
    mockProc?.kill('SIGTERM');
  });

  async function startFlow(
    page: Page,
    provider: 'GOOGLE' | 'MICROSOFT',
    token: string,
    scenario = 'success',
  ) {
    const nonce = encodeClientNonce(crypto.getRandomValues(new Uint8Array(32)));
    const start = await page.request.post(`${shim.baseUrl}/start`, {
      headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      data: { provider, client_nonce: nonce, scenario },
    });
    expect(start.ok()).toBe(true);
    const body = await start.json();
    await page.goto(body.authorizationUrl);
    await page.click('#approve');
    await page.waitForSelector('#oauth-landing');
    const ticket = await page.locator('#ticket').innerText();
    const error = await page.locator('#error').innerText();
    return { ticket, error, nonce };
  }

  it('GOOGLE happy path with real GoTrue JWT', async () => {
    const page = await browser.newPage();
    const { ticket, error, nonce } = await startFlow(page, 'GOOGLE', shim.tokenA);
    expect(error).toBe('');
    expect(ticket).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const fin = await page.request.post(`${shim.baseUrl}/finalize`, {
      headers: { Authorization: `Bearer ${shim.tokenA}`, 'content-type': 'application/json' },
      data: { provider: 'GOOGLE', ticket, client_nonce: nonce },
    });
    expect(fin.status()).toBe(200);
    const cons = await page.request.get(`${shim.baseUrl}/connections`, {
      headers: { Authorization: `Bearer ${shim.tokenA}` },
    });
    expect((await cons.json()).connections.some((c: { provider: string }) => c.provider === 'GOOGLE')).toBe(
      true,
    );
    await page.close();
  });

  it('MICROSOFT happy path with real GoTrue JWT', async () => {
    const page = await browser.newPage();
    await shim.harness.pool.query('DELETE FROM public.calendar_connections');
    const { ticket, error, nonce } = await startFlow(page, 'MICROSOFT', shim.tokenA);
    expect(error).toBe('');
    const fin = await page.request.post(`${shim.baseUrl}/finalize`, {
      headers: { Authorization: `Bearer ${shim.tokenA}`, 'content-type': 'application/json' },
      data: { provider: 'MICROSOFT', ticket, client_nonce: nonce },
    });
    expect(fin.status()).toBe(200);
    const cons = await page.request.get(`${shim.baseUrl}/connections`, {
      headers: { Authorization: `Bearer ${shim.tokenA}` },
    });
    expect(
      (await cons.json()).connections.some((c: { provider: string }) => c.provider === 'MICROSOFT'),
    ).toBe(true);
    await page.close();
  });

  it('consent denied yields no ticket', async () => {
    const page = await browser.newPage();
    await shim.harness.pool.query('DELETE FROM public.calendar_connections');
    const { ticket, error } = await startFlow(page, 'GOOGLE', shim.tokenA, 'deny');
    expect(ticket).toBe('');
    expect(error).toBeTruthy();
    await page.close();
  });

  it('finalize without JWT denied', async () => {
    const page = await browser.newPage();
    const { ticket, nonce } = await startFlow(page, 'GOOGLE', shim.tokenA);
    const fin = await page.request.post(`${shim.baseUrl}/finalize`, {
      headers: { 'content-type': 'application/json' },
      data: { provider: 'GOOGLE', ticket, client_nonce: nonce },
    });
    expect(fin.status()).toBe(401);
    await page.close();
  });

  it('ATTACK A: other user JWT cannot finalize ticket', async () => {
    const page = await browser.newPage();
    const { ticket, nonce } = await startFlow(page, 'GOOGLE', shim.tokenA);
    const fin = await page.request.post(`${shim.baseUrl}/finalize`, {
      headers: { Authorization: `Bearer ${shim.tokenB}`, 'content-type': 'application/json' },
      data: { provider: 'GOOGLE', ticket, client_nonce: nonce },
    });
    expect(fin.status()).toBe(403);
    await page.close();
  });

  it('ticket replay denied under real JWT', async () => {
    const page = await browser.newPage();
    const { ticket, nonce } = await startFlow(page, 'GOOGLE', shim.tokenA);
    const first = await page.request.post(`${shim.baseUrl}/finalize`, {
      headers: { Authorization: `Bearer ${shim.tokenA}`, 'content-type': 'application/json' },
      data: { provider: 'GOOGLE', ticket, client_nonce: nonce },
    });
    expect(first.status()).toBe(200);
    const second = await page.request.post(`${shim.baseUrl}/finalize`, {
      headers: { Authorization: `Bearer ${shim.tokenA}`, 'content-type': 'application/json' },
      data: { provider: 'GOOGLE', ticket, client_nonce: nonce },
    });
    expect(second.status()).toBe(403);
    await page.close();
  });

  it('raw UUID bearer is rejected (JWT required)', async () => {
    const page = await browser.newPage();
    const start = await page.request.post(`${shim.baseUrl}/start`, {
      headers: { Authorization: `Bearer ${shim.userA}`, 'content-type': 'application/json' },
      data: {
        provider: 'GOOGLE',
        client_nonce: encodeClientNonce(crypto.getRandomValues(new Uint8Array(32))),
      },
    });
    expect(start.status()).toBe(401);
    await page.close();
  });
});
