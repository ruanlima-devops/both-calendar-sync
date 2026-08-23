import { describe, expect, it } from 'vitest';
import { isSafeAppRedirect } from './oauth-redirect';

describe('OAuth return URL allowlist', () => {
  it('allows native scheme', () => {
    expect(isSafeAppRedirect('unify://oauth')).toBe(true);
    expect(isSafeAppRedirect('unify://oauth?connected=google')).toBe(true);
    expect(isSafeAppRedirect('both://oauth')).toBe(true);
    expect(isSafeAppRedirect('both-dev://oauth')).toBe(true);
    expect(isSafeAppRedirect('both-stg://oauth')).toBe(true);
  });

  it('allows localhost web', () => {
    expect(isSafeAppRedirect('http://localhost:8081/oauth')).toBe(true);
  });

  it('allows APP_URL origin', () => {
    expect(
      isSafeAppRedirect('https://app.example.com/oauth', { appUrl: 'https://app.example.com' }),
    ).toBe(true);
  });

  it('rejects open redirects', () => {
    expect(isSafeAppRedirect('https://evil.example/oauth')).toBe(false);
    expect(isSafeAppRedirect('https://app.example.com/login')).toBe(false);
  });
});
