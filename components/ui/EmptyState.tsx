import { View } from 'react-native';
import { Button } from '@/components/ui/Button';
import { Typography } from '@/components/ui/Typography';
import { useSession } from '@/context/session';
import { space } from '@/lib/theme';

export function EmptyState({
  title,
  description,
  actionLabel,
  onAction,
}: {
  title: string;
  description: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  const { theme } = useSession();
  return (
    <View
      style={{
        paddingVertical: space.xxxl,
        paddingHorizontal: space.xl,
        alignItems: 'center',
        gap: space.md,
      }}
    >
      <View
        style={{
          width: 48,
          height: 48,
          borderRadius: theme.radius,
          backgroundColor: theme.surfaceMuted,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Typography variant="sectionTitle" muted>
          ◦
        </Typography>
      </View>
      <Typography variant="cardTitle" style={{ textAlign: 'center' }}>
        {title}
      </Typography>
      <Typography variant="body" muted style={{ textAlign: 'center', maxWidth: 320 }}>
        {description}
      </Typography>
      {actionLabel && onAction ? (
        <View style={{ marginTop: space.sm, minWidth: 180 }}>
          <Button label={actionLabel} onPress={onAction} />
        </View>
      ) : null}
    </View>
  );
}
