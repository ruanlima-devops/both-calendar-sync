import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { BothLogo } from '@/components/brand/BothLogo';
import { usePreferredColorScheme } from '@/hooks/usePreferredColorScheme';
import { schemeTokens, space } from '@/lib/theme';

export function SessionSplash() {
  const colors = schemeTokens(usePreferredColorScheme());

  return (
    <View
      style={[styles.root, { backgroundColor: colors.bg }]}
      accessibilityRole="progressbar"
      accessibilityLabel="Carregando o Both"
    >
      <BothLogo colors={colors} />
      <ActivityIndicator color={colors.muted} style={styles.spinner} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  spinner: {
    marginTop: space.xxl,
  },
});
