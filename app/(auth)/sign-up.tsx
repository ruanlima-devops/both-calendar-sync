import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { type Href, useRouter } from 'expo-router';
import { AuthFooter } from '@/components/auth/AuthFooter';
import { AuthPasswordField } from '@/components/auth/AuthPasswordField';
import { AuthPrimaryButton } from '@/components/auth/AuthPrimaryButton';
import { AuthShell } from '@/components/auth/AuthShell';
import { AuthTextField } from '@/components/auth/AuthTextField';
import { GoogleSignInButton } from '@/components/auth/GoogleSignInButton';
import { BothLogo } from '@/components/brand/BothLogo';
import { useGoogleAuth } from '@/hooks/useGoogleAuth';
import { usePreferredColorScheme } from '@/hooks/usePreferredColorScheme';
import { signUpWithEmailPassword } from '@/lib/auth/email-password';
import { schemeTokens, space, type } from '@/lib/theme';

export default function SignUpScreen() {
  const router = useRouter();
  const colors = schemeTokens(usePreferredColorScheme());
  const { signIn, busy: googleBusy, error: googleError } = useGoogleAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<{
    email?: string;
    password?: string;
    confirm?: string;
  }>({});

  async function onSignUp() {
    if (busy || googleBusy) return;
    setBusy(true);
    setError(null);
    setFieldError({});
    try {
      const result = await signUpWithEmailPassword({ email, password, confirmPassword });
      if (result.status === 'busy') return;
      if (result.status === 'validation') {
        if (result.category === 'WEAK_PASSWORD') {
          setFieldError({ password: result.message });
        } else if (result.message.includes('coincidem')) {
          setFieldError({ confirm: result.message });
        } else if (result.message.toLowerCase().includes('e-mail')) {
          setFieldError({ email: result.message });
        } else {
          setError(result.message);
        }
        return;
      }
      if (result.status === 'error') {
        setError(result.message);
        return;
      }
      if (result.status === 'success') {
        router.replace('/');
        return;
      }
      // confirm_email | check_email — same UX (anti-enumeration)
      const nextEmail = 'email' in result ? result.email : email;
      router.replace(
        (`/(auth)/confirm-email?email=${encodeURIComponent(nextEmail)}` as unknown) as Href,
      );
    } finally {
      setBusy(false);
    }
  }

  const blocked = busy || googleBusy;
  const banner = error ?? googleError;

  return (
    <AuthShell colors={colors} footer={<AuthFooter colors={colors} />}>
      <View style={styles.hero}>
        <BothLogo colors={colors} />
        <Text
          style={[styles.title, { color: colors.text }]}
          accessibilityRole="header"
          maxFontSizeMultiplier={1.35}
        >
          Crie sua conta
        </Text>
        <Text style={[styles.subtitle, { color: colors.muted }]} maxFontSizeMultiplier={1.4}>
          Cadastre-se com e-mail e senha. Você também pode continuar com o Google.
        </Text>
      </View>

      <View style={styles.actions}>
        <AuthTextField
          colors={colors}
          label="E-mail"
          value={email}
          onChangeText={setEmail}
          keyboardType="email-address"
          autoComplete="email"
          textContentType="emailAddress"
          placeholder="voce@email.com"
          error={fieldError.email}
          editable={!blocked}
          testID="signup-email"
        />
        <AuthPasswordField
          colors={colors}
          label="Senha"
          value={password}
          onChangeText={setPassword}
          error={fieldError.password}
          showRequirements
          autoComplete="new-password"
          testID="signup-password"
        />
        <AuthPasswordField
          colors={colors}
          label="Confirmar senha"
          value={confirmPassword}
          onChangeText={setConfirmPassword}
          error={fieldError.confirm}
          autoComplete="new-password"
          testID="signup-confirm"
        />
        <AuthPrimaryButton
          colors={colors}
          label="Criar conta"
          onPress={() => void onSignUp()}
          loading={busy}
          disabled={blocked && !busy}
          testID="signup-submit"
        />

        {banner ? (
          <Text
            style={[styles.error, { color: colors.danger, backgroundColor: colors.dangerMuted }]}
            accessibilityRole="alert"
            accessibilityLiveRegion="polite"
          >
            {banner}
          </Text>
        ) : null}

        <View style={styles.orRow} accessibilityRole="text">
          <View style={[styles.rule, { backgroundColor: colors.hairline }]} />
          <Text style={[styles.or, { color: colors.muted }]}>ou</Text>
          <View style={[styles.rule, { backgroundColor: colors.hairline }]} />
        </View>

        <GoogleSignInButton colors={colors} busy={blocked} onPress={() => void signIn()} />

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
    paddingBottom: space.xl,
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
    gap: space.md,
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
    marginTop: space.sm,
  },
  rule: {
    flex: 1,
    height: StyleSheet.hairlineWidth,
  },
  or: {
    fontSize: type.caption,
    fontWeight: '500',
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
