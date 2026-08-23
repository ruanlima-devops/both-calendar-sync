import { ActivityIndicator, Pressable, Text } from 'react-native';
import { useSession } from '@/context/session';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';

export function Button({
  label,
  onPress,
  disabled,
  loading,
  variant = 'primary',
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
  variant?: Variant;
}) {
  const { theme } = useSession();
  const isPrimary = variant === 'primary';
  const isDanger = variant === 'danger';
  const isGhost = variant === 'ghost';
  const isSecondary = variant === 'secondary';

  const bg = isPrimary ? theme.primary : isDanger ? theme.danger : isSecondary ? theme.surfaceMuted : 'transparent';
  const textColor = isPrimary || isDanger ? theme.primaryText : theme.text;
  const borderColor = isGhost ? theme.border : isSecondary ? theme.border : 'transparent';
  const borderWidth = isGhost || isSecondary ? 1 : 0;

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || loading}
      accessibilityRole="button"
      accessibilityState={{ disabled: Boolean(disabled || loading), busy: Boolean(loading) }}
      style={({ pressed }) => ({
        backgroundColor: bg,
        borderRadius: theme.radius,
        paddingVertical: theme.pad * 0.65,
        paddingHorizontal: theme.pad,
        alignItems: 'center',
        justifyContent: 'center',
        opacity: disabled || loading ? 0.5 : pressed ? 0.88 : 1,
        borderWidth,
        borderColor,
        minHeight: 44,
        flexDirection: 'row',
        gap: 8,
      })}
    >
      {loading ? <ActivityIndicator color={textColor} size="small" /> : null}
      <Text style={{ color: textColor, fontWeight: '600', fontSize: 15 }}>{label}</Text>
    </Pressable>
  );
}
