import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AppErrorBoundary } from '@/components/AppErrorBoundary';
import { OfflineBanner } from '@/components/OfflineBanner';
import { SessionProvider, useSession } from '@/context/session';
import { usePreferredColorScheme } from '@/hooks/usePreferredColorScheme';
import { resolveColorScheme } from '@/lib/theme';
import type { ColorSchemePreference } from '@/lib/types';

function ThemedStatusBar() {
  const system = usePreferredColorScheme();
  const { profile } = useSession();
  const scheme = resolveColorScheme(profile?.color_scheme as ColorSchemePreference | undefined, system);
  return <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />;
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <AppErrorBoundary>
        <SessionProvider>
          <ThemedStatusBar />
          <OfflineBanner />
          <Stack screenOptions={{ headerShown: false }} />
        </SessionProvider>
      </AppErrorBoundary>
    </SafeAreaProvider>
  );
}
