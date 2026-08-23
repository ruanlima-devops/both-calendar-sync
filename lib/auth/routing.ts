import type { Profile } from '@/lib/types';

export type AuthStatus = 'loading' | 'authenticated' | 'unauthenticated';

export type SessionDestination = '/(auth)/login' | '/(onboarding)' | '/(app)/(tabs)';

export function destinationForSession(
  status: AuthStatus,
  profile: Profile | null,
): SessionDestination | null {
  if (status === 'loading') return null;
  if (status === 'unauthenticated') return '/(auth)/login';
  if (!profile?.onboarding_completed_at) return '/(onboarding)';
  return '/(app)/(tabs)';
}
