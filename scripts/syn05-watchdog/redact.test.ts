import { describe, expect, it } from 'vitest';
import { redactText, sanitizeLogEventMessage, safeErrorMessage } from './redact.ts';

describe('sanitizeLogEventMessage / redactText', () => {
  it('redacts bearer tokens', () => {
    const out = sanitizeLogEventMessage('Authorization Bearer abcdefghijklmnop');
    expect(out).not.toMatch(/abcdefghijklmnop/);
    expect(out).toMatch(/\[redacted\]/i);
  });

  it('redacts JWTs', () => {
    const jwt =
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.signaturepart';
    const out = sanitizeLogEventMessage(`token=${jwt}`);
    expect(out).not.toContain(jwt);
  });

  it('redacts emails', () => {
    const out = sanitizeLogEventMessage('user alice@example.com failed');
    expect(out).not.toContain('alice@example.com');
    expect(out).toContain('[email]');
  });

  it('redacts api keys in query strings', () => {
    const out = sanitizeLogEventMessage('GET /x?api_key=supersecretkey123&x=1');
    expect(out).not.toContain('supersecretkey123');
  });

  it('redacts URL userinfo credentials', () => {
    const out = sanitizeLogEventMessage('https://admin:hunter2@host.example/path');
    expect(out).not.toContain('hunter2');
    expect(out).not.toContain('admin:hunter2');
  });

  it('redacts cookies and passwords', () => {
    const out = sanitizeLogEventMessage('Set-Cookie: session=abc123xyz; Path=/ password=sekrit');
    expect(out).not.toContain('abc123xyz');
    expect(out).not.toContain('sekrit');
  });

  it('handles malformed input without throwing secrets', () => {
    const weird = { toString: () => 'Bearer leaktokenvalue99' };
    const out = sanitizeLogEventMessage(weird as unknown as string);
    expect(out).not.toContain('leaktokenvalue99');
  });

  it('truncates excessively long payloads', () => {
    const long = `ok ${'a'.repeat(5000)}`;
    const out = sanitizeLogEventMessage(long, 100);
    expect(out.length).toBeLessThanOrEqual(101);
    expect(out.endsWith('…')).toBe(true);
  });

  it('is idempotent', () => {
    const once = sanitizeLogEventMessage('bearer tokentokentoken email@x.com');
    const twice = sanitizeLogEventMessage(once);
    expect(twice).toBe(once);
  });

  it('safeErrorMessage never echoes raw bearer', () => {
    const msg = safeErrorMessage(new Error('fetch failed Authorization: Bearer supersecrettoken'));
    expect(msg).not.toContain('supersecrettoken');
  });

  it('preserves operational edge log shape after redact', () => {
    const edge =
      'POST | 500 | https://qszggrrjhcwltnmxpxcy.supabase.co/functions/v1/billing-webhook';
    const out = sanitizeLogEventMessage(edge);
    expect(out).toContain('POST | 500 |');
    expect(out).toContain('billing-webhook');
  });
});

describe('redactText headers', () => {
  it('redacts authorization header-like text', () => {
    const out = redactText('authorization: Bearer xyzxyzxyzxyz', 200);
    expect(out).not.toContain('xyzxyzxyzxyz');
  });
});
