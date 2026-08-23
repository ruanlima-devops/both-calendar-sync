import { Redirect, Stack } from 'expo-router';
import { SessionSplash } from '@/components/auth/SessionSplash';
import { useSession } from '@/context/session';
import { destinationForSession } from '@/lib/auth/routing';

export default function AuthLayout() {
  const { status, profile } = useSession();
  const destination = destinationForSession(status, profile);

  if (status === 'loading') return <SessionSplash />;
  if (status === 'authenticated' && destination && destination !== '/(auth)/login') {
    return <Redirect href={destination} />;
  }

  return <Stack screenOptions={{ headerShown: false, animation: 'fade' }} />;
}
