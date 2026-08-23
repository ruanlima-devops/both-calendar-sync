import { Redirect } from 'expo-router';
import { SessionSplash } from '@/components/auth/SessionSplash';
import { useSession } from '@/context/session';
import { destinationForSession } from '@/lib/auth/routing';

export default function Index() {
  const { status, profile } = useSession();
  const destination = destinationForSession(status, profile);

  if (!destination) return <SessionSplash />;
  return <Redirect href={destination} />;
}
