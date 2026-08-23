import { View, type ViewProps } from 'react-native';
import { useSession } from '@/context/session';
import { space } from '@/lib/theme';

export function Card({ children, style, ...rest }: ViewProps) {
  const { theme } = useSession();
  return (
    <View
      style={[
        {
          backgroundColor: theme.surface,
          borderRadius: theme.radius,
          borderWidth: 1,
          borderColor: theme.border,
          padding: theme.pad,
          gap: space.md,
        },
        style,
      ]}
      {...rest}
    >
      {children}
    </View>
  );
}
