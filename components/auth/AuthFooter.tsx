import { StyleSheet, Text, View } from 'react-native';
import { type Href, useRouter } from 'expo-router';
import { space, type, type SchemeTokens } from '@/lib/theme';

type AuthFooterProps = {
  colors: SchemeTokens;
};

export function AuthFooter({ colors }: AuthFooterProps) {
  const router = useRouter();

  return (
    <View style={styles.wrap}>
      <Text style={[styles.text, { color: colors.muted }]} maxFontSizeMultiplier={1.5}>
        Ao continuar, você concorda com os{' '}
        <Text
          onPress={() => router.push('/(auth)/terms' as Href)}
          style={[styles.link, { color: colors.text }]}
          accessibilityRole="link"
          accessibilityLabel="Termos de Uso"
        >
          Termos de Uso
        </Text>
        {' e a '}
        <Text
          onPress={() => router.push('/(auth)/privacy' as Href)}
          style={[styles.link, { color: colors.text }]}
          accessibilityRole="link"
          accessibilityLabel="Política de Privacidade"
        >
          Política de Privacidade
        </Text>
        .
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: 'center',
  },
  text: {
    fontSize: type.legal,
    lineHeight: 18,
    textAlign: 'center',
  },
  link: {
    fontWeight: '600',
  },
});
