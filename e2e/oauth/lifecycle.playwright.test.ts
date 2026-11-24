/**
 * Playwright E2E against local mock providers + OAuth shim + disposable Postgres.
 * Skips when OAUTH_LOCAL_DATABASE_URL is unset or Chromium cannot launch.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer } from 'node:http';
import { spawn, type ChildProcess } from 'node:child_process';
import { chromium, type Browser, type Page } from 'playwright';
import { encodeClientNonce } from '../../lib/oauth-complete.ts';
import { localPgUrl } from '../../supabase/functions/_shared/testing/pg-db.ts';
import { startLocalOAuthShim, type LocalOAuthShim } from '../../scripts/oauth-local/local-oauth-shim.ts';

const pgReady = (() => {
  try {
    return Boolean(localPgUrl());
  } catch {
    return false;
  }
})();

const describeE2E = pgReady ? describe : describe.skip;

describeE2E('Playwright OAuth local E2E (mock providers)', () => {
  let mockProc: ChildProcess;
  let mockPort = 0;
  let shim: LocalOAuthShim;
  let browser: Browser;

  beforeAll(async () => {
    // Start mock providers on ephemeral port via tiny inline server if script port busy —
    // reuse scripts/oauth-local/mock-providers.mjs with OAUTH_MOCK_PORT=0 by spawning after binding.
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
      mockProc.stderr?.on('data', () => {});
      mockProc.on('exit', (code) => reject(new Error(`mock exited ${code}`)));
    });

    shim = await startLocalOAuthShim(`http://127.0.0.1:${mockPort}`);
    browser = await chromium.launch({ headless: true });
  }, 60_000);

  afterAll(async () => {
    await browser?.close();
    await shim?.close();
    mockProc?.kill('SIGTERM');
  });

  async function startFlow(page: Page, provider: 'GOOGLE' | 'MICROSOFT', userId: string, scenario = 'success') {
    const nonce = encodeClientNonce(crypto.getRandomValues(new Uint8Array(32)));
    const start = await page.request.post(`${shim.baseUrl}/start`, {
      headers: { Authorization: `Bearer ${userId}`, 'content-type': 'application/json' },
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

  it('GOOGLE happy path: consent → ticket → finalize → connection', async () => {
    const page = await browser.newPage();
    const { ticket, error, nonce } = await startFlow(page, 'GOOGLE', shim.userA);
    expect(error).toBe('');
    expect(ticket).toMatch(/^[A-Za-z0-9_-]{43}$/);

    const fin = await page.request.post(`${shim.baseUrl}/finalize`, {
      headers: { Authorization: `Bearer ${shim.userA}`, 'content-type': 'application/json' },
      data: { provider: 'GOOGLE', ticket, client_nonce: nonce },
    });
    expect(fin.status()).toBe(200);

    const cons = await page.request.get(`${shim.baseUrl}/connections`, {
      headers: { Authorization: `Bearer ${shim.userA}` },
    });
    const data = await cons.json();
    expect(data.connections.some((c: { provider: string }) => c.provider === 'GOOGLE')).toBe(true);
    await page.close();
  });

  it('MICROSOFT happy path: consent → ticket → finalize → connection', async () => {
    const page = await browser.newPage();
    // reset connections for clean assert
    await shim.harness.pool.query('DELETE FROM public.calendar_connections');
    const { ticket, error, nonce } = await startFlow(page, 'MICROSOFT', shim.userA);
    expect(error).toBe('');
    expect(ticket).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const fin = await page.request.post(`${shim.baseUrl}/finalize`, {
      headers: { Authorization: `Bearer ${shim.userA}`, 'content-type': 'application/json' },
      data: { provider: 'MICROSOFT', ticket, client_nonce: nonce },
    });
    expect(fin.status()).toBe(200);
    const cons = await page.request.get(`${shim.baseUrl}/connections`, {
      headers: { Authorization: `Bearer ${shim.userA}` },
    });
    const data = await cons.json();
    expect(data.connections.some((c: { provider: string }) => c.provider === 'MICROSOFT')).toBe(true);
    await page.close();
  });

  it('consent denied yields no ticket and no connection', async () => {
    const page = await browser.newPage();
    await shim.harness.pool.query('DELETE FROM public.calendar_connections');
    const { ticket, error } = await startFlow(page, 'GOOGLE', shim.userA, 'deny');
    expect(ticket).toBe('');
    expect(error).toBeTruthy();
    const cons = await page.request.get(`${shim.baseUrl}/connections`, {
      headers: { Authorization: `Bearer ${shim.userA}` },
    });
    expect((await cons.json()).connections).toHaveLength(0);
    await page.close();
  });

  it('finalize without Authorization is denied', async () => {
    const page = await browser.newPage();
    const { ticket, nonce } = await startFlow(page, 'GOOGLE', shim.userA);
    const fin = await page.request.post(`${shim.baseUrl}/finalize`, {
      headers: { 'content-type': 'application/json' },
      data: { provider: 'GOOGLE', ticket, client_nonce: nonce },
    });
    expect(fin.status()).toBe(401);
    await page.close();
  });

  it('cross-user finalize denied (Attack A via browser API)', async () => {
    const page = await browser.newPage();
    const { ticket, nonce } = await startFlow(page, 'GOOGLE', shim.userA);
    const fin = await page.request.post(`${shim.baseUrl}/finalize`, {
      headers: { Authorization: `Bearer ${shim.userB}`, 'content-type': 'application/json' },
      data: { provider: 'GOOGLE', ticket, client_nonce: nonce },
    });
    expect(fin.status()).toBe(403);
    await page.close();
  });

  it('ticket replay denied', async () => {
    const page = await browser.newPage();
    const { ticket, nonce } = await startFlow(page, 'GOOGLE', shim.userA);
    const first = await page.request.post(`${shim.baseUrl}/finalize`, {
      headers: { Authorization: `Bearer ${shim.userA}`, 'content-type': 'application/json' },
      data: { provider: 'GOOGLE', ticket, client_nonce: nonce },
    });
    expect(first.status()).toBe(200);
    const second = await page.request.post(`${shim.baseUrl}/finalize`, {
      headers: { Authorization: `Bearer ${shim.userA}`, 'content-type': 'application/json' },
      data: { provider: 'GOOGLE', ticket, client_nonce: nonce },
    });
    expect(second.status()).toBe(403);
    await page.close();
  });
});
