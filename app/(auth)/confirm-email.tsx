import { useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { type Href, useLocalSearchParams, useRouter } from 'expo-router';
import { AuthFooter } from '@/components/auth/AuthFooter';
import { AuthPrimaryButton } from '@/components/auth/AuthPrimaryButton';
import { AuthShell } from '@/components/auth/AuthShell';
import { BothLogo } from '@/components/brand/BothLogo';
import { usePreferredColorScheme } from '@/hooks/usePreferredColorScheme';
import {
  resendCooldownRemainingMs,
  resendSignupConfirmation,
} from '@/lib/auth/email-password';
import { AUTH_MESSAGES } from '@/lib/auth/errors';
import { schemeTokens, space, type } from '@/lib/theme';

function maskEmail(email: string): string {
  const [user, domain] = email.split('@');
  if (!user || !domain) return 'seu e-mail';
  const visible = user.slice(0, Math.min(2, user.length));
  return `${visible}***@${domain}`;
}

export default function ConfirmEmailScreen() {
  const router = useRouter();
  const colors = schemeTokens(usePreferredColorScheme());
  const params = useLocalSearchParams<{ email?: string }>();
  const email = typeof params.email === 'string' ? params.email : '';
  const masked = useMemo(() => (email ? maskEmail(email) : 'seu e-mail'), [email]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(() => resendCooldownRemainingMs(email));

  async function onResend() {
    if (!email || busy) return;
    const remaining = resendCooldownRemainingMs(email);
    if (remaining > 0) {
      setCooldown(remaining);
      setError(`Aguarde ${Math.ceil(remaining / 1000)}s para reenviar.`);
      return;
    }
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const result = await resendSignupConfirmation(email);
      setCooldown(resendCooldownRemainingMs(email));
      if (result.status === 'error' || result.status === 'validation') {
        setError(result.message);
        return;
      }
      setMessage(AUTH_MESSAGES.signupCheckEmail);
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthShell colors={colors} footer={<AuthFooter colors={colors} />}>
      <View style={styles.hero}>
        <BothLogo colors={colors} />
        <Text style={[styles.title, { color: colors.text }]} accessibilityRole="header">
          Confirme seu e-mail
        </Text>
        <Text style={[styles.subtitle, { color: colors.muted }]}>
          Enviamos um link de confirmação para {masked}. Abra o e-mail e toque no botão para ativar
          sua conta Both.
        </Text>
      </View>

      <View style={styles.actions}>
        <AuthPrimaryButton
          colors={colors}
          label={cooldown > 0 ? `Reenviar (${Math.ceil(cooldown / 1000)}s)` : 'Reenviar e-mail'}
          onPress={() => void onResend()}
          loading={busy}
          disabled={!email || cooldown > 0}
        />
        {message ? (
          <Text style={[styles.info, { color: colors.text, backgroundColor: colors.border + '55' }]}>
            {message}
          </Text>
        ) : null}
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
          Já confirmei — ir para o login
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
    fontSize: type.caption,
    lineHeight: 20,
    textAlign: 'center',
    padding: space.md,
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
