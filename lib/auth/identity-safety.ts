/**
 * Identity safety rules for STG-06G (client-side policy helpers).
 * Never auto-link identities based on client-supplied e-mail alone.
 */

export type IdentityLinkDecision =
  | { allow: false; reason: 'CLIENT_EMAIL_MATCH_FORBIDDEN' }
  | { allow: false; reason: 'UNAUTHENTICATED' }
  | { allow: false; reason: 'AMBIGUOUS' }
  | { allow: true; reason: 'EXPLICIT_AUTHENTICATED_PROOF_REQUIRED' };

/**
 * Client must never decide to merge two accounts because two e-mails look equal.
 * Explicit linking (future increment) requires an authenticated session plus
 * official Supabase Auth APIs with proof of both identities.
 */
export function decideClientIdentityLink(input: {
  authenticated: boolean;
  sameEmailClaim: boolean;
  explicitUserIntent: boolean;
}): IdentityLinkDecision {
  if (input.sameEmailClaim && !input.authenticated) {
    return { allow: false, reason: 'CLIENT_EMAIL_MATCH_FORBIDDEN' };
  }
  if (!input.authenticated) {
    return { allow: false, reason: 'UNAUTHENTICATED' };
  }
  if (input.sameEmailClaim && !input.explicitUserIntent) {
    return { allow: false, reason: 'CLIENT_EMAIL_MATCH_FORBIDDEN' };
  }
  if (!input.explicitUserIntent) {
    return { allow: false, reason: 'AMBIGUOUS' };
  }
  // Still not implemented in-app — callers must use official Auth APIs later.
  return { allow: true, reason: 'EXPLICIT_AUTHENTICATED_PROOF_REQUIRED' };
}

export const IDENTITY_SCENARIO_MATRIX = [
  'new_password_signup',
  'new_google_login',
  'google_exists_password_signup_same_email',
  'password_exists_google_login_same_email',
  'password_recovery',
  'add_login_method_authenticated',
  'unverified_identity',
  'lookalike_third_party_email',
  'second_browser_session',
  'calendar_disconnect_without_auth_change',
] as const;

export type IdentityScenario = (typeof IDENTITY_SCENARIO_MATRIX)[number];

/** Expected product posture per scenario (documentation + test contract). */
export function expectedPosture(scenario: IdentityScenario): string {
  switch (scenario) {
    case 'new_password_signup':
      return 'create_auth_user_profile_trial_once';
    case 'new_google_login':
      return 'create_auth_user_profile_trial_once';
    case 'google_exists_password_signup_same_email':
      return 'no_silent_merge_safe_check_email_ux';
    case 'password_exists_google_login_same_email':
      return 'depend_on_supabase_project_settings_no_client_merge';
    case 'password_recovery':
      return 'recovery_callback_then_update_password';
    case 'add_login_method_authenticated':
      return 'deferred_explicit_link_increment';
    case 'unverified_identity':
      return 'block_password_login_until_confirmed';
    case 'lookalike_third_party_email':
      return 'treat_as_distinct_users';
    case 'second_browser_session':
      return 'independent_sessions_same_user_id';
    case 'calendar_disconnect_without_auth_change':
      return 'oauth_calendar_independent_of_login_method';
  }
}
