import { KeyboardAvoidingView, Platform, ScrollView, View, type ViewProps } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useSession } from '@/context/session';
import { layout, space } from '@/lib/theme';

export function Screen({
  children,
  scroll,
  maxWidth = layout.contentMaxWidth,
  style,
  edges = ['top', 'bottom'],
  ...rest
}: ViewProps & {
  scroll?: boolean;
  maxWidth?: number;
  edges?: ('top' | 'bottom' | 'left' | 'right')[];
}) {
  const { theme } = useSession();
  const inner = (
    <View
      style={[
        {
          width: '100%',
          maxWidth,
          alignSelf: 'center',
          paddingHorizontal: space.lg,
          paddingVertical: space.xl,
          gap: space.lg,
        },
        style,
      ]}
      {...rest}
    >
      {children}
    </View>
  );

  const body = scroll ? (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 8 : 0}
    >
      <ScrollView
        style={{ flex: 1, backgroundColor: theme.bg }}
        contentContainerStyle={{ flexGrow: 1 }}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
      >
        {inner}
      </ScrollView>
    </KeyboardAvoidingView>
  ) : (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>{inner}</View>
  );

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.bg }} edges={edges}>
      {body}
    </SafeAreaView>
  );
}
