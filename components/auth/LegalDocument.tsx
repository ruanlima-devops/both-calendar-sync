import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { AuthShell } from '@/components/auth/AuthShell';
import { BothLogo } from '@/components/brand/BothLogo';
import { usePreferredColorScheme } from '@/hooks/usePreferredColorScheme';
import { schemeTokens, space, type } from '@/lib/theme';

type LegalDocumentProps = {
  title: string;
  body: string;
};

export function LegalDocument({ title, body }: LegalDocumentProps) {
  const router = useRouter();
  const colors = schemeTokens(usePreferredColorScheme());

  return (
    <AuthShell colors={colors}>
      <View style={styles.block}>
        <BothLogo colors={colors} size="sm" />
        <Text
          style={[styles.title, { color: colors.text }]}
          accessibilityRole="header"
          maxFontSizeMultiplier={1.4}
        >
          {title}
        </Text>
        {body.split(/\n\n+/).map((paragraph) => (
          <Text
            key={paragraph.slice(0, 24)}
            style={[styles.body, { color: colors.muted }]}
            maxFontSizeMultiplier={1.5}
          >
            {paragraph}
          </Text>
        ))}
        <Pressable
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel="Voltar"
          style={({ pressed }) => [styles.back, { opacity: pressed ? 0.7 : 1 }]}
        >
          <Text style={[styles.backLabel, { color: colors.primary }]}>Voltar</Text>
        </Pressable>
      </View>
    </AuthShell>
  );
}

const styles = StyleSheet.create({
  block: {
    gap: space.lg,
  },
  title: {
    marginTop: space.sm,
    fontSize: 22,
    fontWeight: '700',
    letterSpacing: -0.4,
  },
  body: {
    fontSize: type.body,
    lineHeight: 24,
  },
  back: {
    alignSelf: 'flex-start',
    minHeight: 44,
    justifyContent: 'center',
  },
  backLabel: {
    fontSize: type.body,
    fontWeight: '600',
  },
});
