/**
 * Cloudflare scheduled adapter — inert / offline negatives.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  ALLOWED_REPO,
  assertGithubApiUrl,
  handleFetchInert,
  handleScheduledInert,
  prepareGithubAppJwtFromEnv,
  validateCfObserverEnv,
} from './cloudflare-scheduled-adapter.ts';
import { createGithubAppJwt } from './github-app-jwt.ts';
import { createInMemoryStatusSource } from './external-observer-foundation.ts';
import { STAGE_ENVIRONMENT, STAGE_PROJECT_REF } from './types.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const NOW = Date.parse('2026-11-22T16:00:00.000Z');

async function pem(): Promise<string> {
  const pair = await crypto.subtle.generateKey(
    {
      name: 'RSASSA-PKCS1-v1_5',
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: 'SHA-256',
    },
    true,
    ['sign', 'verify'],
  );
  const der = new Uint8Array(await crypto.subtle.exportKey('pkcs8', pair.privateKey));
  let bin = '';
  for (let i = 0; i < der.length; i++) bin += String.fromCharCode(der[i]!);
  const b64 = btoa(bin);
  const lines = b64.match(/.{1,64}/g) ?? [b64];
  return `-----BEGIN PRIVATE KEY-----\n${lines.join('\n')}\n-----END PRIVATE KEY-----`;
}

describe('env validation', () => {
  it('rejects Supabase PAT on observer', () => {
    expect(validateCfObserverEnv({ SUPABASE_ACCESS_TOKEN: 'sbp_fc_x' }).ok).toBe(false);
    expect(validateCfObserverEnv({ SUPABASE_LOGS_READ_TOKEN: 'x' }).ok).toBe(false);
  });

  it('rejects unexpected repo', () => {
    expect(validateCfObserverEnv({ EXPECTED_REPO: 'other/repo' }).ok).toBe(false);
  });

  it('allows empty env', () => {
    expect(validateCfObserverEnv({}).ok).toBe(true);
  });

  it('rejects insecure heartbeat url', () => {
    expect(
      validateCfObserverEnv({ BETTERSTACK_HEARTBEAT_A_URL: 'http://example.com/hb' }).ok,
    ).toBe(false);
  });
});

describe('github host pin', () => {
  it('allows api.github.com https', () => {
    expect(() => assertGithubApiUrl('https://api.github.com/repos/x')).not.toThrow();
  });

  it('rejects other hosts / http', () => {
    expect(() => assertGithubApiUrl('https://evil.example/api')).toThrow();
    expect(() => assertGithubApiUrl('http://api.github.com/x')).toThrow();
  });
});

describe('scheduled inert', () => {
  it('gate OFF → DISABLED_INTENTIONALLY, never HEALTHY, no heartbeat', async () => {
    const r = await handleScheduledInert(
      { scheduledTime: NOW, cron: '' },
      { OBSERVER_AUTHORIZATION_GATE: 'OFF' },
      { nowMs: NOW },
    );
    expect(r.operationally_active).toBe(false);
    expect(r.heartbeat_sent).toBe(false);
    expect(r.http_performed).toBe(false);
    expect(r.classification).toBe('DISABLED_INTENTIONALLY');
    expect(r.classification).not.toBe('HEALTHY');
    expect(r.environment).toBe(STAGE_ENVIRONMENT);
    expect(r.project_ref).toBe(STAGE_PROJECT_REF);
  });

  it('missing gate → disabled', async () => {
    const r = await handleScheduledInert({ scheduledTime: NOW, cron: '' }, {}, { nowMs: NOW });
    expect(r.classification).toBe('DISABLED_INTENTIONALLY');
  });

  it('supabase token in env → CONFIG_INVALID', async () => {
    const r = await handleScheduledInert(
      { scheduledTime: NOW, cron: '' },
      { OBSERVER_AUTHORIZATION_GATE: 'OFF', SUPABASE_ACCESS_TOKEN: 'sbp_x' },
      { nowMs: NOW },
    );
    expect(r.reason_code).toBe('supabase_pat_forbidden_on_observer');
  });

  it('authorized gate without status source → OBSERVER_BLIND, not HEALTHY', async () => {
    const r = await handleScheduledInert(
      { scheduledTime: NOW, cron: '' },
      { OBSERVER_AUTHORIZATION_GATE: 'PO_AUTHORIZED', GITHUB_APP_ID: '1' },
      { nowMs: NOW, statusSource: null },
    );
    expect(r.classification).toBe('OBSERVER_BLIND');
    expect(r.heartbeat_sent).toBe(false);
    expect(r.operationally_active).toBe(false);
  });

  it('does not mark HEALTHY without evidence', async () => {
    const src = createInMemoryStatusSource(null);
    const r = await handleScheduledInert(
      { scheduledTime: NOW, cron: '' },
      { OBSERVER_AUTHORIZATION_GATE: 'PO_AUTHORIZED' },
      { nowMs: NOW, statusSource: src },
    );
    expect(r.classification).not.toBe('HEALTHY');
  });
});

describe('JWT from env', () => {
  it('missing installation id', async () => {
    const r = await prepareGithubAppJwtFromEnv({
      GITHUB_APP_ID: '1',
      GITHUB_APP_PRIVATE_KEY_PKCS8: await pem(),
    });
    expect(r.ok).toBe(false);
  });

  it('invalid installation id', async () => {
    const r = await prepareGithubAppJwtFromEnv({
      GITHUB_APP_ID: '1',
      GITHUB_INSTALLATION_ID: 'abc',
      GITHUB_APP_PRIVATE_KEY_PKCS8: await pem(),
    });
    expect(r.ok).toBe(false);
  });

  it('prepares jwt with valid env (no network)', async () => {
    const key = await pem();
    const r = await prepareGithubAppJwtFromEnv({
      GITHUB_APP_ID: '42',
      GITHUB_INSTALLATION_ID: '99',
      GITHUB_APP_PRIVATE_KEY_PKCS8: key,
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.token.split('.')).toHaveLength(3);
  });

  it('wrong key material fails sign/import', async () => {
    const r = await createGithubAppJwt({
      app_id: '1',
      private_key_pkcs8: '-----BEGIN PRIVATE KEY-----\nAAAA\n-----END PRIVATE KEY-----',
    });
    expect(r.ok).toBe(false);
  });
});

describe('inert fetch / wrangler', () => {
  it('fetch stub is inert', async () => {
    const res = await handleFetchInert(new Request('https://example.invalid/'));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { operationally_active: boolean; cron_enabled: boolean };
    expect(body.operationally_active).toBe(false);
    expect(body.cron_enabled).toBe(false);
  });

  it('wrangler.toml has empty crons and gate OFF', () => {
    const toml = readFileSync(path.join(HERE, 'observer-worker/wrangler.toml'), 'utf8');
    expect(toml).toMatch(/crons\s*=\s*\[\s*\]/);
    expect(toml).toMatch(/OBSERVER_AUTHORIZATION_GATE\s*=\s*"OFF"/);
    expect(toml).not.toMatch(/\*\/\d+ \* \* \* \*/);
  });

  it('adapter source has no supabase client import / no side-effect fetch on import', () => {
    const src = readFileSync(path.join(HERE, 'cloudflare-scheduled-adapter.ts'), 'utf8');
    expect(src).not.toMatch(/supabase-logs-client/);
    expect(src).not.toMatch(/from 'node:/);
    expect(src).toContain(ALLOWED_REPO);
  });

  it('SEC-07 tombstone preserved', () => {
    const entry = readFileSync(
      path.join(ROOT, 'supabase/functions/sync-calendar/index.ts'),
      'utf8',
    );
    expect(entry).toContain('handleLegacySyncCalendar');
  });
});
