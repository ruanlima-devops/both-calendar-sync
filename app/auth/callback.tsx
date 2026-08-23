import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';
import { SessionSplash } from '@/components/auth/SessionSplash';
import { createSessionFromUrl } from '@/lib/auth/callback';
import { isCancelledAuth, userMessageForAuthError } from '@/lib/auth/errors';
import { usePreferredColorScheme } from '@/hooks/usePreferredColorScheme';
import { schemeTokens, space, type } from '@/lib/theme';

WebBrowser.maybeCompleteAuthSession();

export default function AuthCallbackScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ error?: string; error_description?: string }>();
  const colors = schemeTokens(usePreferredColorScheme());
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function complete() {
      try {
        const initial = await Linking.getInitialURL();
        const href = initial ?? (typeof window !== 'undefined' ? window.location.href : null);
        if (!href) {
          router.replace('/');
          return;
        }
        await createSessionFromUrl(href);
        if (!cancelled) router.replace('/');
      } catch (caught) {
        if (cancelled) return;
        if (isCancelledAuth(caught) || isCancelledAuth(params.error)) {
          router.replace('/(auth)/login');
          return;
        }
        setError(userMessageForAuthError(caught));
      }
    }

    void complete();
    return () => {
      cancelled = true;
    };
  }, [params.error, router]);

  if (error) {
    return (
      <View style={[styles.failed, { backgroundColor: colors.bg }]}>
        <Text style={[styles.message, { color: colors.text }]} accessibilityRole="alert">
          {error}
        </Text>
        <Text
          onPress={() => router.replace('/(auth)/login')}
          style={[styles.link, { color: colors.primary }]}
          accessibilityRole="link"
        >
          Voltar ao login
        </Text>
      </View>
    );
  }

  return <SessionSplash />;
}

const styles = StyleSheet.create({
  failed: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: space.xl,
    gap: space.lg,
  },
  message: {
    fontSize: type.body,
    textAlign: 'center',
    lineHeight: 24,
  },
  link: {
    fontSize: type.body,
    fontWeight: '600',
  },
});
