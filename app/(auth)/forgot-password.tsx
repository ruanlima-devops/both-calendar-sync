import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { type Href, useRouter } from 'expo-router';
import { AuthFooter } from '@/components/auth/AuthFooter';
import { AuthPrimaryButton } from '@/components/auth/AuthPrimaryButton';
import { AuthShell } from '@/components/auth/AuthShell';
import { AuthTextField } from '@/components/auth/AuthTextField';
import { BothLogo } from '@/components/brand/BothLogo';
import { usePreferredColorScheme } from '@/hooks/usePreferredColorScheme';
import { requestPasswordReset } from '@/lib/auth/email-password';
import { AUTH_MESSAGES } from '@/lib/auth/errors';
import { schemeTokens, space, type } from '@/lib/theme';

export default function ForgotPasswordScreen() {
  const router = useRouter();
  const colors = schemeTokens(usePreferredColorScheme());
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await requestPasswordReset(email);
      if (result.status === 'validation' || result.status === 'error') {
        setError(result.message);
        return;
      }
      setSent(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthShell colors={colors} footer={<AuthFooter colors={colors} />}>
      <View style={styles.hero}>
        <BothLogo colors={colors} />
        <Text style={[styles.title, { color: colors.text }]} accessibilityRole="header">
          Redefinir senha
        </Text>
        <Text style={[styles.subtitle, { color: colors.muted }]}>
          Informe o e-mail da sua conta Both. Se ela existir, enviaremos um link seguro para criar
          uma nova senha.
        </Text>
      </View>

      <View style={styles.actions}>
        {sent ? (
          <Text
            style={[styles.info, { color: colors.text, backgroundColor: colors.border + '55' }]}
            accessibilityRole="alert"
          >
            {AUTH_MESSAGES.resetCheckEmail}
          </Text>
        ) : (
          <>
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
              testID="forgot-email"
            />
            <AuthPrimaryButton
              colors={colors}
              label="Enviar link"
              onPress={() => void onSubmit()}
              loading={busy}
              testID="forgot-submit"
            />
          </>
        )}
        {error ? (
          <Text
            style={[styles.error, { color: colors.danger, backgroundColor: colors.dangerMuted }]}
            accessibilityRole="alert"
          >
            {error}
          </Text>
        ) : null}
        <Text
          onPress={() => router.replace('/(auth)/login' as Href)}
          style={[styles.link, { color: colors.primary }]}
          accessibilityRole="link"
        >
          Voltar ao login
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
  info: {
    fontSize: type.body,
    lineHeight: 22,
    textAlign: 'center',
    padding: space.lg,
    borderRadius: 12,
    overflow: 'hidden',
  },
  error: {
    fontSize: type.caption,
    lineHeight: 20,
    textAlign: 'center',
    padding: space.md,
    borderRadius: 12,
    overflow: 'hidden',
  },
  link: {
    fontSize: type.body,
    fontWeight: '600',
    textAlign: 'center',
    minHeight: 44,
  },
});
