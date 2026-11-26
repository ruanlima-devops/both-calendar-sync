import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { type Href, useRouter } from 'expo-router';
import { AppleSignInButton } from '@/components/auth/AppleSignInButton';
import { AuthFooter } from '@/components/auth/AuthFooter';
import { AuthPasswordField } from '@/components/auth/AuthPasswordField';
import { AuthPrimaryButton } from '@/components/auth/AuthPrimaryButton';
import { AuthShell } from '@/components/auth/AuthShell';
import { AuthTextField } from '@/components/auth/AuthTextField';
import { GoogleSignInButton } from '@/components/auth/GoogleSignInButton';
import { BothLogo } from '@/components/brand/BothLogo';
import { useGoogleAuth } from '@/hooks/useGoogleAuth';
import { usePreferredColorScheme } from '@/hooks/usePreferredColorScheme';
import { isAppleAuthAvailable, signInWithApple } from '@/lib/auth/apple';
import { signInWithEmailPassword } from '@/lib/auth/email-password';
import { userMessageForAuthError } from '@/lib/auth/errors';
import { schemeTokens, space, type } from '@/lib/theme';

export default function LoginScreen() {
  const router = useRouter();
  const colors = schemeTokens(usePreferredColorScheme());
  const { signIn, busy: googleBusy, error: googleError } = useGoogleAuth();
  const [appleAvailable, setAppleAvailable] = useState(false);
  const [appleBusy, setAppleBusy] = useState(false);
  const [appleError, setAppleError] = useState<string | null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [passwordBusy, setPasswordBusy] = useState(false);
  const [passwordError, setPasswordError] = useState<string | null>(null);

  useEffect(() => {
    void isAppleAuthAvailable().then(setAppleAvailable);
  }, []);

  async function onApple() {
    if (appleBusy || googleBusy || passwordBusy) return;
    setAppleBusy(true);
    setAppleError(null);
    setPasswordError(null);
    try {
      const result = await signInWithApple();
      if (result.status === 'error') setAppleError(result.message);
    } catch (err) {
      setAppleError(userMessageForAuthError(err));
    } finally {
      setAppleBusy(false);
    }
  }

  async function onPasswordLogin() {
    if (passwordBusy || googleBusy || appleBusy) return;
    setPasswordBusy(true);
    setPasswordError(null);
    setAppleError(null);
    try {
      const result = await signInWithEmailPassword({ email, password });
      if (result.status === 'validation' || result.status === 'error') {
        setPasswordError(result.message);
      }
      // success → SessionProvider + auth layout redirect
    } finally {
      setPasswordBusy(false);
    }
  }

  const busy = googleBusy || appleBusy || passwordBusy;
  const error = passwordError ?? appleError ?? googleError;

  return (
    <AuthShell colors={colors} footer={<AuthFooter colors={colors} />}>
      <View style={styles.hero}>
        <BothLogo colors={colors} />
        <Text
          style={[styles.title, { color: colors.text }]}
          accessibilityRole="header"
          maxFontSizeMultiplier={1.35}
        >
          Bem-vindo ao Both
        </Text>
        <Text style={[styles.subtitle, { color: colors.muted }]} maxFontSizeMultiplier={1.4}>
          Organize sua vida, seus compromissos e seu tempo em um só lugar.
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
          editable={!busy}
          testID="login-email"
        />
        <AuthPasswordField
          colors={colors}
          label="Senha"
          value={password}
          onChangeText={setPassword}
          autoComplete="current-password"
          testID="login-password"
        />
        <Text
          onPress={() => router.push('/(auth)/forgot-password' as Href)}
          style={[styles.forgot, { color: colors.primary }]}
          accessibilityRole="link"
          accessibilityLabel="Esqueci minha senha"
        >
          Esqueci minha senha
        </Text>
        <AuthPrimaryButton
          colors={colors}
          label="Entrar"
          onPress={() => void onPasswordLogin()}
          loading={passwordBusy}
          disabled={busy && !passwordBusy}
          testID="login-submit"
        />

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

        {appleAvailable ? (
          <AppleSignInButton
            dark={colors.bg === '#0b1220' || colors.bg.startsWith('#0')}
            busy={busy}
            onPress={() => void onApple()}
          />
        ) : null}
        <GoogleSignInButton
          colors={colors}
          busy={googleBusy}
          disabled={busy}
          onPress={() => void signIn()}
        />

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
  forgot: {
    alignSelf: 'flex-end',
    fontSize: type.caption,
    fontWeight: '600',
    minHeight: 44,
    textAlignVertical: 'center',
    paddingTop: 4,
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
  signup: {
    fontSize: type.body,
    textAlign: 'center',
    lineHeight: 22,
    marginTop: space.sm,
  },
  signupLink: {
    fontWeight: '600',
  },
});
