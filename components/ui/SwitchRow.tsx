import { Switch, View } from 'react-native';
import { Typography } from '@/components/ui/Typography';
import { useSession } from '@/context/session';
import { layout, space } from '@/lib/theme';

export function SwitchRow({
  label,
  description,
  value,
  onValueChange,
  disabled,
}: {
  label: string;
  description?: string;
  value: boolean;
  onValueChange: (next: boolean) => void;
  disabled?: boolean;
}) {
  const { theme } = useSession();
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: space.md,
        minHeight: layout.tapTarget,
      }}
    >
      <View style={{ flex: 1, gap: 2 }}>
        <Typography variant="body">{label}</Typography>
        {description ? (
          <Typography variant="metadata" muted>
            {description}
          </Typography>
        ) : null}
      </View>
      <Switch
        value={value}
        onValueChange={onValueChange}
        disabled={disabled}
        trackColor={{ false: theme.border, true: theme.primary }}
        accessibilityLabel={label}
      />
    </View>
  );
}
