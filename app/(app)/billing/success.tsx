import { useEffect, useRef } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Typography } from '@/components/ui/Typography';
import { useEntitlement } from '@/context/entitlement';
import { useSession } from '@/context/session';

export default function BillingSuccessScreen() {
  const router = useRouter();
  const { theme } = useSession();
  const { refresh } = useEntitlement();
  const done = useRef(false);

  useEffect(() => {
    let cancelled = false;
    async function confirm() {
      for (let attempt = 0; attempt < 10; attempt += 1) {
        const ent = await refresh();
        if (cancelled || done.current) return;
        if (ent.hasAccess && ent.source === 'subscription') {
          done.current = true;
          router.replace('/(app)/(tabs)');
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, 1200));
      }
      if (!cancelled) router.replace('/(app)/paywall');
    }
    void confirm();
    return () => {
      cancelled = true;
    };
  }, [refresh, router]);

  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.bg, gap: 12 }}>
      <ActivityIndicator color={theme.primary} />
      <Typography variant="body" muted>
        Confirmando sua assinatura…
      </Typography>
    </View>
  );
}
