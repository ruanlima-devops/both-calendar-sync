import { Redirect, Stack } from 'expo-router';
import { SessionSplash } from '@/components/auth/SessionSplash';
import { useSession } from '@/context/session';
import { destinationForSession } from '@/lib/auth/routing';

export default function OnboardingLayout() {
  const { status, profile } = useSession();

  if (status === 'loading') return <SessionSplash />;

  const destination = destinationForSession(status, profile);
  if (destination && destination !== '/(onboarding)') {
    return <Redirect href={destination} />;
  }

  return <Stack screenOptions={{ headerShown: false }} />;
}
