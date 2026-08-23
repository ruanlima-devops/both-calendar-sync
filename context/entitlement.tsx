import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { Platform } from 'react-native';
import { computeEntitlement, type Entitlement, type SubscriptionRecord } from '@/lib/billing/entitlement';
import { configurePurchases, logOutPurchases } from '@/lib/billing/purchases';
import { supabase } from '@/lib/supabase';
import { useSession } from '@/context/session';

interface EntitlementValue {
  subscription: SubscriptionRecord | null;
  entitlement: Entitlement;
  loading: boolean;
  refresh: () => Promise<Entitlement>;
}

const Ctx = createContext<EntitlementValue | null>(null);

export function EntitlementProvider({ children }: { children: ReactNode }) {
  const { session, status } = useSession();
  const [subscription, setSubscription] = useState<SubscriptionRecord | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (): Promise<Entitlement> => {
    if (!session?.user.id) {
      setSubscription(null);
      setLoading(false);
      if (Platform.OS !== 'web') await logOutPurchases();
      return computeEntitlement(null);
    }
    setLoading(true);
    if (Platform.OS === 'ios' || Platform.OS === 'android') {
      try {
        await configurePurchases(session.user.id);
      } catch {
        /* keys may be absent before RC setup */
      }
    }
    const { data } = await supabase
      .from('user_subscriptions')
      .select('*')
      .eq('user_id', session.user.id)
      .maybeSingle();
    const row = (data as SubscriptionRecord | null) ?? null;
    setSubscription(row);
    setLoading(false);
    return computeEntitlement(row);
  }, [session?.user.id]);

  useEffect(() => {
    if (status === 'loading') return;
    void load();
  }, [load, status]);

  useEffect(() => {
    if (!session?.user.id) return;
    const channel = supabase
      .channel(`subscription-${session.user.id}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'user_subscriptions',
          filter: `user_id=eq.${session.user.id}`,
        },
        (payload) => {
          setSubscription(payload.new as SubscriptionRecord);
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [session?.user.id]);

  const entitlement = useMemo(() => computeEntitlement(subscription), [subscription]);

  const value = useMemo(
    () => ({ subscription, entitlement, loading, refresh: load }),
    [subscription, entitlement, loading, load],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useEntitlement(): EntitlementValue {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useEntitlement outside provider');
  return ctx;
}
