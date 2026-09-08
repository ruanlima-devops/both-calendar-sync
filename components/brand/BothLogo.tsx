import { View, Text, StyleSheet } from 'react-native';
import { layout, space, type, type SchemeTokens } from '@/lib/theme';

type BothLogoProps = {
  colors: SchemeTokens;
  size?: 'sm' | 'md' | 'lg';
};

const MARK = {
  sm: 28,
  md: layout.logoMark,
  lg: 44,
} as const;

export function BothLogo({ colors, size = 'md' }: BothLogoProps) {
  const mark = MARK[size];
  const inner = Math.round(mark * 0.42);

  return (
    <View style={styles.wrap} accessibilityRole="image" accessibilityLabel="Both">
      <View
        style={[
          styles.mark,
          {
            width: mark,
            height: mark,
            borderRadius: mark * 0.28,
            backgroundColor: colors.primary,
          },
        ]}
      >
        <View
          style={{
            width: inner,
            height: inner,
            borderRadius: inner * 0.28,
            backgroundColor: colors.surface,
            opacity: 0.95,
          }}
        />
        <View
          style={[
            styles.overlap,
            {
              width: inner * 0.72,
              height: inner * 0.72,
              borderRadius: inner * 0.22,
              borderColor: colors.surface,
              backgroundColor: colors.primary,
            },
          ]}
        />
      </View>
      <Text style={[styles.wordmark, { color: colors.text }]} maxFontSizeMultiplier={1.35}>
        BOTH
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: 'center',
    gap: space.md,
  },
  mark: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  overlap: {
    position: 'absolute',
    right: '18%',
    bottom: '18%',
    borderWidth: 2,
  },
  wordmark: {
    fontSize: type.brand,
    fontWeight: '700',
    letterSpacing: 5.5,
  },
});
