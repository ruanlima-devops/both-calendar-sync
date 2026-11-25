import { describe, expect, it } from 'vitest';
import { authEventNeedsProfileReload, destinationForSession } from './routing';

describe('authEventNeedsProfileReload', () => {
  it('does not block when another tab re-broadcasts SIGNED_IN for the loaded user', () => {
    expect(authEventNeedsProfileReload('SIGNED_IN', 'u1', 'u1')).toBe(false);
    expect(authEventNeedsProfileReload('USER_UPDATED', 'u1', 'u1')).toBe(false);
  });

  it('blocks for a first sign-in or a different user', () => {
    expect(authEventNeedsProfileReload('SIGNED_IN', 'u1', null)).toBe(true);
    expect(authEventNeedsProfileReload('SIGNED_IN', 'u2', 'u1')).toBe(true);
  });

  it('never blocks on token refresh', () => {
    expect(authEventNeedsProfileReload('TOKEN_REFRESHED', 'u2', 'u1')).toBe(false);
  });
});

describe('destinationForSession', () => {
  it('routes by auth status and onboarding', () => {
    expect(destinationForSession('loading', null)).toBeNull();
    expect(destinationForSession('unauthenticated', null)).toBe('/(auth)/login');
    expect(destinationForSession('authenticated', { onboarding_completed_at: null } as never)).toBe('/(onboarding)');
    expect(destinationForSession('authenticated', { onboarding_completed_at: '2026-01-01' } as never)).toBe('/(app)/(tabs)');
  });
});
