import { TextInput, View, type TextInputProps } from 'react-native';
import { Typography } from '@/components/ui/Typography';
import { useSession } from '@/context/session';
import { space } from '@/lib/theme';

export function Input({
  label,
  helper,
  error,
  style,
  ...rest
}: TextInputProps & { label?: string; helper?: string; error?: string }) {
  const { theme } = useSession();
  return (
    <View style={{ gap: space.xs }}>
      {label ? <Typography variant="caption">{label}</Typography> : null}
      <TextInput
        placeholderTextColor={theme.muted}
        style={[
          {
            backgroundColor: theme.surface,
            borderRadius: theme.radius,
            borderWidth: 1,
            borderColor: error ? theme.danger : theme.border,
            paddingHorizontal: space.md,
            paddingVertical: space.sm + 2,
            color: theme.text,
            fontSize: 15,
            minHeight: 44,
          },
          style,
        ]}
        {...rest}
      />
      {error ? (
        <Typography variant="metadata" style={{ color: theme.danger }}>
          {error}
        </Typography>
      ) : helper ? (
        <Typography variant="metadata" muted>
          {helper}
        </Typography>
      ) : null}
    </View>
  );
}
