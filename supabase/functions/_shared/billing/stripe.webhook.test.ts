import { createHmac } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { stubDenoEnv } from '../testing/fake-db.ts';
import {
  parseStripeSignatureHeader,
  verifyWebhookSignature,
} from './stripe.ts';

const SECRET = 'whsec_stg05b_test_secret_value';

beforeEach(() => {
  stubDenoEnv({ STRIPE_WEBHOOK_SECRET: SECRET });
  vi.spyOn(console, 'log').mockImplementation(() => {});
});

function sign(payload: string, secret = SECRET, ts = Math.floor(Date.now() / 1000)): string {
  const mac = createHmac('sha256', secret).update(`${ts}.${payload}`).digest('hex');
  return `t=${ts},v1=${mac}`;
}

describe('parseStripeSignatureHeader', () => {
  it('collects timestamp and all v1 signatures', () => {
    const parsed = parseStripeSignatureHeader('t=100,v1=aaa,v1=bbb,v0=ccc');
    expect(parsed.timestamp).toBe('100');
    expect(parsed.signatures).toEqual(['aaa', 'bbb']);
  });
});

describe('verifyWebhookSignature', () => {
  const payload = '{"id":"evt_1","type":"checkout.session.completed"}';

  it('rejects missing signature header', async () => {
    expect(await verifyWebhookSignature(payload, '', { secret: SECRET })).toBe(false);
  });

  it('rejects invalid signature', async () => {
    const header = `t=${Math.floor(Date.now() / 1000)},v1=deadbeef`;
    expect(await verifyWebhookSignature(payload, header, { secret: SECRET })).toBe(false);
  });

  it('accepts valid signature (timing-safe path)', async () => {
    const header = sign(payload);
    expect(await verifyWebhookSignature(payload, header, { secret: SECRET })).toBe(true);
  });

  it('accepts when a later v1 candidate matches', async () => {
    const ts = Math.floor(Date.now() / 1000);
    const good = createHmac('sha256', SECRET).update(`${ts}.${payload}`).digest('hex');
    const header = `t=${ts},v1=00ff,v1=${good}`;
    expect(await verifyWebhookSignature(payload, header, { secret: SECRET })).toBe(true);
  });

  it('rejects expired timestamp outside tolerance', async () => {
    const old = Math.floor(Date.now() / 1000) - 301;
    const header = sign(payload, SECRET, old);
    expect(
      await verifyWebhookSignature(payload, header, {
        secret: SECRET,
        nowMs: Date.now(),
        toleranceSec: 300,
      }),
    ).toBe(false);
  });

  it('does not use Deno env when secret option is provided', async () => {
    stubDenoEnv({});
    const header = sign(payload);
    expect(await verifyWebhookSignature(payload, header, { secret: SECRET })).toBe(true);
  });
});
