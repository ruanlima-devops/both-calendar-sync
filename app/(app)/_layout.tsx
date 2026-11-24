import { Redirect, Stack, useSegments } from 'expo-router';
import { View } from 'react-native';
import { SessionSplash } from '@/components/auth/SessionSplash';
import { NotificationCenter } from '@/components/notifications/NotificationCenter';
import { NotificationToast } from '@/components/notifications/NotificationToast';
import { EntitlementProvider, useEntitlement } from '@/context/entitlement';
import { NotificationProvider } from '@/context/notifications';
import { ToastProvider } from '@/context/toast';
import { useSession } from '@/context/session';
import { destinationForSession } from '@/lib/auth/routing';
import { resolveEntitlementRedirect } from '@/lib/billing/entitlement-gate';

function EntitlementGate({ children }: { children: React.ReactNode }) {
  const segments = useSegments();
  const { entitlement, loading } = useEntitlement();
  const path = segments.join('/');

  if (loading) return <SessionSplash />;

  const redirect = resolveEntitlementRedirect(entitlement, path);
  if (redirect) {
    return <Redirect href={redirect} />;
  }

  return <>{children}</>;
}

export default function AppGroupLayout() {
  const { status, profile } = useSession();

  if (status === 'loading') return <SessionSplash />;

  const destination = destinationForSession(status, profile);
  if (destination && destination !== '/(app)/(tabs)') {
    return <Redirect href={destination} />;
  }

  return (
    <EntitlementProvider>
      <EntitlementGate>
        <NotificationProvider>
          <ToastProvider>
            <View style={{ flex: 1 }}>
              <Stack screenOptions={{ headerShown: false }} />
              <NotificationToast />
              <NotificationCenter />
            </View>
          </ToastProvider>
        </NotificationProvider>
      </EntitlementGate>
    </EntitlementProvider>
  );
}
