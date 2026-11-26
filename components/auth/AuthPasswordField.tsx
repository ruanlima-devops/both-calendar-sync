import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { AuthTextField } from '@/components/auth/AuthTextField';
import { evaluatePassword } from '@/lib/auth/password-policy';
import { space, type, type SchemeTokens } from '@/lib/theme';

type Props = {
  colors: SchemeTokens;
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  error?: string | null;
  showRequirements?: boolean;
  autoComplete?: 'password' | 'new-password' | 'current-password';
  testID?: string;
};

export function AuthPasswordField({
  colors,
  label,
  value,
  onChangeText,
  error,
  showRequirements = false,
  autoComplete = 'password',
  testID,
}: Props) {
  const [visible, setVisible] = useState(false);
  const requirements = showRequirements ? evaluatePassword(value).requirements : [];

  return (
    <View style={styles.wrap}>
      <View>
        <AuthTextField
          colors={colors}
          label={label}
          value={value}
          onChangeText={onChangeText}
          error={error}
          secureTextEntry={!visible}
          autoComplete={autoComplete}
          textContentType={autoComplete === 'new-password' ? 'newPassword' : 'password'}
          testID={testID}
        />
        <Pressable
          onPress={() => setVisible((v) => !v)}
          accessibilityRole="button"
          accessibilityLabel={visible ? 'Ocultar senha' : 'Mostrar senha'}
          hitSlop={8}
          style={styles.toggle}
        >
          <Text style={[styles.toggleText, { color: colors.primary }]}>
            {visible ? 'Ocultar' : 'Mostrar'}
          </Text>
        </Pressable>
      </View>
      {showRequirements ? (
        <View
          style={styles.reqs}
          accessibilityRole="summary"
          accessibilityLabel="Requisitos de senha"
        >
          {requirements.map((req) => (
            <Text
              key={req.id}
              style={[styles.req, { color: req.met ? colors.primary : colors.muted }]}
            >
              {req.met ? '✓' : '○'} {req.label}
            </Text>
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    gap: space.sm,
  },
  toggle: {
    position: 'absolute',
    right: space.md,
    top: 34,
    minHeight: 44,
    justifyContent: 'center',
  },
  toggleText: {
    fontSize: type.caption,
    fontWeight: '600',
  },
  reqs: {
    gap: 4,
    paddingLeft: 2,
  },
  req: {
    fontSize: type.caption,
    lineHeight: 18,
  },
});
