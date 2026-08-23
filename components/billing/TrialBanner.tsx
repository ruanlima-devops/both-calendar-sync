import { Platform, Pressable, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Typography } from '@/components/ui/Typography';
import { useEntitlement } from '@/context/entitlement';
import { useSession } from '@/context/session';
import { space } from '@/lib/theme';

export function TrialBanner() {
  const { theme } = useSession();
  const { entitlement } = useEntitlement();
  const router = useRouter();

  if (entitlement.source !== 'trial' || !entitlement.hasAccess) return null;
  if (entitlement.trialUrgency === 'discrete') return null;

  const days = entitlement.daysRemaining ?? 0;
  const copy =
    entitlement.trialUrgency === 'urgent'
      ? days <= 1
        ? 'Seu teste termina amanhã'
        : `Seu teste termina em ${days} dias`
      : `Seu teste termina em ${days} dias`;

  const bg =
    entitlement.trialUrgency === 'urgent' ? theme.dangerSurface : theme.surfaceMuted;
  const border = entitlement.trialUrgency === 'urgent' ? theme.danger : theme.border;

  return (
    <Pressable
      onPress={() => router.push('/(app)/paywall')}
      style={{
        marginHorizontal: space.lg,
        marginBottom: space.sm,
        padding: space.md,
        borderRadius: theme.radius,
        backgroundColor: bg,
        borderWidth: 1,
        borderColor: border,
      }}
      accessibilityRole="button"
    >
      <Typography variant="caption" style={{ color: entitlement.trialUrgency === 'urgent' ? theme.danger : theme.text }}>
        {copy}
      </Typography>
      {entitlement.trialUrgency === 'urgent' ? (
        <Typography variant="metadata" style={{ color: theme.primary, marginTop: 4 }}>
          Assinar Both Pro →
        </Typography>
      ) : null}
    </Pressable>
  );
}

export function TrialBadge() {
  const { entitlement } = useEntitlement();
  const { theme } = useSession();
  if (entitlement.source !== 'trial' || !entitlement.hasAccess || entitlement.trialUrgency !== 'discrete') {
    return null;
  }
  if ((entitlement.daysRemaining ?? 0) <= 0) return null;
  return (
    <View
      style={{
        paddingHorizontal: 8,
        paddingVertical: 4,
        borderRadius: 999,
        backgroundColor: theme.surfaceMuted,
      }}
    >
      <Typography variant="metadata" muted>
        {entitlement.daysRemaining}d teste
      </Typography>
    </View>
  );
}

void Platform;
