import { type ReactNode, useEffect, useRef } from 'react';
import {
  Animated,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  View,
  useWindowDimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { layout, space, type SchemeTokens } from '@/lib/theme';

type AuthShellProps = {
  colors: SchemeTokens;
  children: ReactNode;
  footer?: ReactNode;
};

export function AuthShell({ colors, children, footer }: AuthShellProps) {
  const { width, height } = useWindowDimensions();
  const compact = height < 720;
  const paneWidth = Math.min(width - space.xl * 2, layout.authMaxWidth);
  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(10)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(opacity, { toValue: 1, duration: 420, useNativeDriver: true }),
      Animated.timing(translateY, { toValue: 0, duration: 420, useNativeDriver: true }),
    ]).start();
  }, [opacity, translateY]);

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: colors.bg }]} edges={['top', 'bottom']}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={[
            styles.scroll,
            { paddingVertical: compact ? space.xl : space.xxxl, minHeight: height * 0.92 },
          ]}
          showsVerticalScrollIndicator={false}
        >
          <Animated.View
            style={[
              styles.pane,
              { width: paneWidth, maxWidth: layout.authMaxWidth, opacity, transform: [{ translateY }] },
            ]}
          >
            <View style={styles.body}>{children}</View>
            {footer ? <View style={styles.footer}>{footer}</View> : null}
          </Animated.View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
  },
  flex: {
    flex: 1,
  },
  scroll: {
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: space.xl,
  },
  pane: {
    flexGrow: 1,
    justifyContent: 'space-between',
    gap: space.xxl,
  },
  body: {
    flexGrow: 1,
    justifyContent: 'center',
  },
  footer: {
    paddingBottom: space.sm,
  },
});
