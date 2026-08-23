import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { AuthFooter } from '@/components/auth/AuthFooter';
import { AuthShell } from '@/components/auth/AuthShell';
import { GoogleSignInButton } from '@/components/auth/GoogleSignInButton';
import { UnifyLogo } from '@/components/brand/UnifyLogo';
import { useGoogleAuth } from '@/hooks/useGoogleAuth';
import { usePreferredColorScheme } from '@/hooks/usePreferredColorScheme';
import { schemeTokens, space, type } from '@/lib/theme';

export default function SignUpScreen() {
  const router = useRouter();
  const colors = schemeTokens(usePreferredColorScheme());
  const { signIn, busy, error } = useGoogleAuth();

  return (
    <AuthShell colors={colors} footer={<AuthFooter colors={colors} />}>
      <View style={styles.hero}>
        <UnifyLogo colors={colors} />
        <Text
          style={[styles.title, { color: colors.text }]}
          accessibilityRole="header"
          maxFontSizeMultiplier={1.35}
        >
          Crie sua conta
        </Text>
        <Text style={[styles.subtitle, { color: colors.muted }]} maxFontSizeMultiplier={1.4}>
          O Unify cria sua conta com o Google. Cadastro com e-mail chega em breve.
        </Text>
      </View>

      <View style={styles.actions}>
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

        <Pressable
          onPress={() => router.replace('/(auth)/login')}
          accessibilityRole="link"
          accessibilityLabel="Já tem uma conta? Entrar"
          style={({ pressed }) => [styles.loginRow, { opacity: pressed ? 0.7 : 1 }]}
        >
          <Text style={[styles.login, { color: colors.muted }]}>
            Já tem uma conta?{' '}
            <Text style={[styles.loginLink, { color: colors.text }]}>Entrar</Text>
          </Text>
        </Pressable>
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
  loginRow: {
    minHeight: 44,
    justifyContent: 'center',
  },
  login: {
    fontSize: type.body,
    textAlign: 'center',
    lineHeight: 22,
  },
  loginLink: {
    fontWeight: '600',
  },
});
