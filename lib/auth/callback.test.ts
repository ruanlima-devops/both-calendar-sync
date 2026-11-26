import { describe, expect, it } from 'vitest';
import { parseAuthCallbackUrl } from '@/lib/auth/callback-url';

describe('parseAuthCallbackUrl', () => {
  it('parses PKCE code callbacks', () => {
    const p = parseAuthCallbackUrl('https://stage.bothcalendar.com/auth/callback?code=abc&sb_flow_id=flow1');
    expect(p.code).toBe('abc');
    expect(p.flowId).toBe('flow1');
  });

  it('parses email confirmation token_hash + type', () => {
    const p = parseAuthCallbackUrl(
      'https://stage.bothcalendar.com/auth/callback?token_hash=th_test&type=signup',
    );
    expect(p.tokenHash).toBe('th_test');
    expect(p.type).toBe('signup');
    expect(p.code).toBeUndefined();
  });

  it('parses recovery token_hash', () => {
    const p = parseAuthCallbackUrl(
      'https://stage.bothcalendar.com/auth/callback?token_hash=th_rec&type=recovery',
    );
    expect(p.tokenHash).toBe('th_rec');
    expect(p.type).toBe('recovery');
  });
});
