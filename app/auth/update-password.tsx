import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { type Href, useRouter } from 'expo-router';
import { AuthFooter } from '@/components/auth/AuthFooter';
import { AuthPasswordField } from '@/components/auth/AuthPasswordField';
import { AuthPrimaryButton } from '@/components/auth/AuthPrimaryButton';
import { AuthShell } from '@/components/auth/AuthShell';
import { BothLogo } from '@/components/brand/BothLogo';
import { usePreferredColorScheme } from '@/hooks/usePreferredColorScheme';
import { updatePasswordAuthenticated } from '@/lib/auth/email-password';
import { AUTH_MESSAGES } from '@/lib/auth/errors';
import { schemeTokens, space, type } from '@/lib/theme';

/**
 * Recovery / authenticated password update.
 * Lives under `/auth` (not `/(auth)`) so authenticated recovery sessions are not
 * redirected away to onboarding before the password is set.
 */
export default function UpdatePasswordScreen() {
  const router = useRouter();
  const colors = schemeTokens(usePreferredColorScheme());
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function onSubmit() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await updatePasswordAuthenticated({ password, confirmPassword });
      if (result.status === 'validation' || result.status === 'error') {
        setError(result.message);
        return;
      }
      if (result.status === 'success') {
        setDone(true);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthShell colors={colors} footer={<AuthFooter colors={colors} />}>
      <View style={styles.hero}>
        <BothLogo colors={colors} />
        <Text style={[styles.title, { color: colors.text }]} accessibilityRole="header">
          {done ? 'Senha atualizada' : 'Nova senha'}
        </Text>
        <Text style={[styles.subtitle, { color: colors.muted }]}>
          {done
            ? AUTH_MESSAGES.passwordUpdated
            : 'Defina uma senha forte para continuar usando o Both com segurança.'}
        </Text>
      </View>

      <View style={styles.actions}>
        {done ? (
          <AuthPrimaryButton
            colors={colors}
            label="Continuar"
            onPress={() => router.replace('/' as Href)}
          />
        ) : (
          <>
            <AuthPasswordField
              colors={colors}
              label="Nova senha"
              value={password}
              onChangeText={setPassword}
              showRequirements
              autoComplete="new-password"
              testID="update-password"
            />
            <AuthPasswordField
              colors={colors}
              label="Confirmar nova senha"
              value={confirmPassword}
              onChangeText={setConfirmPassword}
              autoComplete="new-password"
              testID="update-password-confirm"
            />
            <AuthPrimaryButton
              colors={colors}
              label="Salvar senha"
              onPress={() => void onSubmit()}
              loading={busy}
              testID="update-password-submit"
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
    padding: space.md,
    borderRadius: 12,
    overflow: 'hidden',
  },
});
