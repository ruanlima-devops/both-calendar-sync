import { describe, expect, it } from 'vitest';
import {
  IDENTITY_SCENARIO_MATRIX,
  decideClientIdentityLink,
  expectedPosture,
} from './identity-safety.ts';

describe('identity-safety', () => {
  it('forbids silent merge from client e-mail match', () => {
    expect(
      decideClientIdentityLink({
        authenticated: false,
        sameEmailClaim: true,
        explicitUserIntent: false,
      }).allow,
    ).toBe(false);

    expect(
      decideClientIdentityLink({
        authenticated: true,
        sameEmailClaim: true,
        explicitUserIntent: false,
      }).reason,
    ).toBe('CLIENT_EMAIL_MATCH_FORBIDDEN');
  });

  it('covers the ten official scenarios', () => {
    expect(IDENTITY_SCENARIO_MATRIX).toHaveLength(10);
    for (const scenario of IDENTITY_SCENARIO_MATRIX) {
      expect(expectedPosture(scenario).length).toBeGreaterThan(5);
    }
  });

  it('keeps calendar disconnect independent of login method', () => {
    expect(expectedPosture('calendar_disconnect_without_auth_change')).toBe(
      'oauth_calendar_independent_of_login_method',
    );
  });
});
