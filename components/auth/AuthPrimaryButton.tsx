import { ActivityIndicator, Pressable, StyleSheet, Text } from 'react-native';
import { layout, space, type, type SchemeTokens } from '@/lib/theme';

type Props = {
  colors: SchemeTokens;
  label: string;
  onPress: () => void;
  loading?: boolean;
  disabled?: boolean;
  testID?: string;
};

export function AuthPrimaryButton({
  colors,
  label,
  onPress,
  loading,
  disabled,
  testID,
}: Props) {
  const blocked = Boolean(disabled || loading);
  return (
    <Pressable
      onPress={onPress}
      disabled={blocked}
      accessibilityRole="button"
      accessibilityState={{ disabled: blocked, busy: Boolean(loading) }}
      testID={testID}
      style={({ pressed }) => [
        styles.btn,
        {
          backgroundColor: colors.primary,
          opacity: blocked ? 0.5 : pressed ? 0.9 : 1,
        },
      ]}
    >
      {loading ? <ActivityIndicator color={colors.primaryText} /> : null}
      <Text style={[styles.label, { color: colors.primaryText }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  btn: {
    minHeight: layout.authButtonHeight,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: space.sm,
    paddingHorizontal: space.lg,
  },
  label: {
    fontSize: type.body,
    fontWeight: '600',
  },
});
