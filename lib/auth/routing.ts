import type { Profile } from '@/lib/types';

export type AuthStatus = 'loading' | 'authenticated' | 'unauthenticated';

export type SessionDestination = '/(auth)/login' | '/(onboarding)' | '/(app)/(tabs)';

/**
 * Whether an auth event must put the app back into `loading` while the profile reloads.
 * Another tab (e.g. the web OAuth popup landing on `/oauth`) re-broadcasts SIGNED_IN for the
 * same user; blocking on it unmounts the navigator and resets this tab to the home route.
 */
export function authEventNeedsProfileReload(
  event: string,
  nextUserId: string,
  readyUserId: string | null,
): boolean {
  if (event === 'TOKEN_REFRESHED') return false;
  return nextUserId !== readyUserId;
}

export function destinationForSession(
  status: AuthStatus,
  profile: Profile | null,
): SessionDestination | null {
  if (status === 'loading') return null;
  if (status === 'unauthenticated') return '/(auth)/login';
  if (!profile?.onboarding_completed_at) return '/(onboarding)';
  return '/(app)/(tabs)';
}
