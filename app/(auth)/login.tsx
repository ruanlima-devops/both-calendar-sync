import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { type Href, useRouter } from 'expo-router';
import { AppleSignInButton } from '@/components/auth/AppleSignInButton';
import { AuthFooter } from '@/components/auth/AuthFooter';
import { AuthShell } from '@/components/auth/AuthShell';
import { GoogleSignInButton } from '@/components/auth/GoogleSignInButton';
import { UnifyLogo } from '@/components/brand/UnifyLogo';
import { useGoogleAuth } from '@/hooks/useGoogleAuth';
import { usePreferredColorScheme } from '@/hooks/usePreferredColorScheme';
import { isAppleAuthAvailable, signInWithApple } from '@/lib/auth/apple';
import { userMessageForAuthError } from '@/lib/auth/errors';
import { schemeTokens, space, type } from '@/lib/theme';

export default function LoginScreen() {
  const router = useRouter();
  const colors = schemeTokens(usePreferredColorScheme());
  const { signIn, busy: googleBusy, error: googleError } = useGoogleAuth();
  const [appleAvailable, setAppleAvailable] = useState(false);
  const [appleBusy, setAppleBusy] = useState(false);
  const [appleError, setAppleError] = useState<string | null>(null);

  useEffect(() => {
    void isAppleAuthAvailable().then(setAppleAvailable);
  }, []);

  async function onApple() {
    if (appleBusy || googleBusy) return;
    setAppleBusy(true);
    setAppleError(null);
    try {
      const result = await signInWithApple();
      if (result.status === 'error') setAppleError(result.message);
    } catch (err) {
      setAppleError(userMessageForAuthError(err));
    } finally {
      setAppleBusy(false);
    }
  }

  const busy = googleBusy || appleBusy;
  const error = appleError ?? googleError;

  return (
    <AuthShell colors={colors} footer={<AuthFooter colors={colors} />}>
      <View style={styles.hero}>
        <UnifyLogo colors={colors} />
        <Text
          style={[styles.title, { color: colors.text }]}
          accessibilityRole="header"
          maxFontSizeMultiplier={1.35}
        >
          Bem-vindo ao Unify
        </Text>
        <Text style={[styles.subtitle, { color: colors.muted }]} maxFontSizeMultiplier={1.4}>
          Organize sua vida, seus compromissos e seu tempo em um só lugar.
        </Text>
      </View>

      <View style={styles.actions}>
        {appleAvailable ? (
          <AppleSignInButton dark={colors.bg === '#0b1220' || colors.bg.startsWith('#0')} busy={busy} onPress={() => void onApple()} />
        ) : null}
        <GoogleSignInButton colors={colors} busy={busy} onPress={() => void signIn()} />
        {error ? (
          <Text
            style={[styles.error, { color: colors.danger, backgroundColor: colors.dangerMuted }]}
            accessibilityRole="alert"
            accessibilityLiveRegion="polite"
          >
            {error}
          </Text>
        ) : null}

        <View style={styles.orRow} accessibilityRole="text">
          <View style={[styles.rule, { backgroundColor: colors.hairline }]} />
          <Text style={[styles.or, { color: colors.muted }]}>ou</Text>
          <View style={[styles.rule, { backgroundColor: colors.hairline }]} />
        </View>

        <Text style={[styles.signup, { color: colors.muted }]}>
          Ainda não tem uma conta?{' '}
          <Text
            onPress={() => router.push('/(auth)/sign-up' as Href)}
            style={[styles.signupLink, { color: colors.text }]}
            accessibilityRole="link"
            accessibilityLabel="Cadastre-se"
          >
            Cadastre-se
          </Text>
        </Text>
      </View>
    </AuthShell>
  );
}

const styles = StyleSheet.create({
  hero: {
    alignItems: 'center',
    paddingBottom: space.xxl,
    gap: space.md,
  },
  title: {
    marginTop: space.sm,
    fontSize: type.title,
    fontWeight: '700',
    letterSpacing: -0.6,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: type.body,
    lineHeight: 24,
    textAlign: 'center',
    maxWidth: 340,
  },
  actions: {
    gap: space.lg,
  },
  error: {
    fontSize: type.caption,
    lineHeight: 20,
    textAlign: 'center',
    paddingVertical: space.md,
    paddingHorizontal: space.lg,
    borderRadius: 12,
    overflow: 'hidden',
  },
  orRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
  },
  rule: {
    flex: 1,
    height: StyleSheet.hairlineWidth,
  },
  or: {
    fontSize: type.caption,
    fontWeight: '500',
  },
  signup: {
    fontSize: type.body,
    textAlign: 'center',
    lineHeight: 22,
  },
  signupLink: {
    fontWeight: '600',
  },
});
