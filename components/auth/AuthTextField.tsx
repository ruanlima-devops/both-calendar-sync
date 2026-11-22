import { TextInput, View, type TextInputProps, StyleSheet, Text } from 'react-native';
import { layout, space, type, type SchemeTokens } from '@/lib/theme';

type Props = TextInputProps & {
  colors: SchemeTokens;
  label: string;
  error?: string | null;
  helper?: string;
};

export function AuthTextField({ colors, label, error, helper, style, ...rest }: Props) {
  return (
    <View style={styles.wrap}>
      <Text style={[styles.label, { color: colors.muted }]}>{label}</Text>
      <TextInput
        placeholderTextColor={colors.muted}
        autoCapitalize="none"
        autoCorrect={false}
        style={[
          styles.input,
          {
            backgroundColor: colors.surface,
            borderColor: error ? colors.danger : colors.border,
            color: colors.text,
          },
          style,
        ]}
        accessibilityLabel={label}
        {...rest}
      />
      {error ? (
        <Text style={[styles.hint, { color: colors.danger }]} accessibilityRole="alert">
          {error}
        </Text>
      ) : helper ? (
        <Text style={[styles.hint, { color: colors.muted }]}>{helper}</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    gap: space.xs,
  },
  label: {
    fontSize: type.caption,
    fontWeight: '500',
  },
  input: {
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: space.md,
    paddingVertical: space.sm + 2,
    fontSize: 15,
    minHeight: layout.authButtonHeight,
  },
  hint: {
    fontSize: type.caption,
    lineHeight: 18,
  },
});
