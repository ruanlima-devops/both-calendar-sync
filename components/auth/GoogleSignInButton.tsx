import {
  ActivityIndicator,
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { layout, space, type, type SchemeTokens } from '@/lib/theme';

type GoogleSignInButtonProps = {
  colors: SchemeTokens;
  busy?: boolean;
  disabled?: boolean;
  onPress: () => void;
};

export function GoogleSignInButton({
  colors,
  busy = false,
  disabled = false,
  onPress,
}: GoogleSignInButtonProps) {
  const inactive = busy || disabled;
  const label = busy ? 'Conectando ao Google...' : 'Continuar com Google';

  return (
    <Pressable
      onPress={onPress}
      disabled={inactive}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={busy ? undefined : 'Abre a autenticação da Google'}
      accessibilityState={{ disabled: inactive, busy }}
      style={({ pressed }) => [
        styles.button,
        {
          backgroundColor: colors.googleButtonBg,
          borderColor: colors.googleButtonBorder,
          opacity: inactive ? 0.72 : pressed ? 0.88 : 1,
          transform: [{ scale: pressed && !inactive ? 0.985 : 1 }],
        },
      ]}
    >
      <View style={styles.content}>
        {busy ? (
          <ActivityIndicator color={colors.googleButtonText} />
        ) : (
          <Image
            source={require('../../assets/images/google-g.png')}
            style={styles.icon}
            accessibilityIgnoresInvertColors
          />
        )}
        <Text
          style={[styles.label, { color: colors.googleButtonText }]}
          maxFontSizeMultiplier={1.4}
        >
          {label}
        </Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    height: layout.authButtonHeight,
    borderRadius: 14,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: space.lg,
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.md,
  },
  icon: {
    width: 18,
    height: 18,
  },
  label: {
    fontSize: type.button,
    fontWeight: '600',
    letterSpacing: -0.2,
  },
});
