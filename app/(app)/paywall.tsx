import { useEffect, useState } from 'react';
import { ActivityIndicator, Linking, Platform, View } from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import { useLocalSearchParams, Link } from 'expo-router';
import { Button } from '@/components/ui/Button';
import { Screen } from '@/components/ui/Screen';
import { Typography } from '@/components/ui/Typography';
import { useEntitlement } from '@/context/entitlement';
import { useSession } from '@/context/session';
import { useToast } from '@/context/toast';
import { fetchBillingPlan, startCheckout } from '@/lib/billing/client';
import {
  getMonthlyPackage,
  isNativeStoreBilling,
  purchaseMonthly,
  restorePurchases,
} from '@/lib/billing/purchases';
import { friendlyError } from '@/lib/errors';
import { space } from '@/lib/theme';
import { supabase } from '@/lib/supabase';

const FEATURES = [
  'Google Calendar',
  'Microsoft Calendar',
  'Sincronização automática',
  'Notificações inteligentes',
  'Resumos semanais',
  'Resumos mensais',
];

export default function PaywallScreen() {
  const { theme } = useSession();
  const { entitlement, refresh } = useEntitlement();
  const { showToast } = useToast();
  const params = useLocalSearchParams<{ canceled?: string }>();
  const [planName, setPlanName] = useState('Both Pro');
  const [priceLabel, setPriceLabel] = useState<string | null>(null);
  const [loadingPlan, setLoadingPlan] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const native = isNativeStoreBilling();

  useEffect(() => {
    void (async () => {
      try {
        if (native) {
          const pack = await getMonthlyPackage();
          if (pack) {
            setPlanName(pack.product.title || 'Both Pro');
            setPriceLabel(pack.product.priceString);
          } else {
            setPriceLabel(null);
          }
        } else {
          const info = await fetchBillingPlan();
          setPlanName(info.plan.name);
          setPriceLabel(info.price?.formatted ?? null);
        }
      } catch {
        setPriceLabel(null);
      } finally {
        setLoadingPlan(false);
      }
    })();
  }, [native]);

  useEffect(() => {
    if (params.canceled) setError(null);
  }, [params.canceled]);

  useEffect(() => {
    void supabase.from('product_events').insert({ name: 'paywall_viewed' });
  }, []);

  async function subscribe() {
    setBusy(true);
    setError(null);
    try {
      if (native) {
        await purchaseMonthly();
        // Wait briefly for RevenueCat webhook → Supabase entitlement.
        await new Promise((r) => setTimeout(r, 1200));
        await refresh();
        showToast('Assinatura ativada');
      } else {
        const url = await startCheckout();
        await WebBrowser.openAuthSessionAsync(url, `${process.env.EXPO_PUBLIC_SUPABASE_URL ?? ''}/`);
        await refresh();
      }
    } catch (err) {
      const code = (err as { code?: string }).code;
      if (code === 'PURCHASE_CANCELLED' || String(err).includes('cancelled')) {
        setError(null);
      } else {
        setError(friendlyError(err, 'Não foi possível concluir a assinatura.'));
      }
    } finally {
      setBusy(false);
    }
  }

  async function restore() {
    setBusy(true);
    setError(null);
    try {
      await restorePurchases();
      await new Promise((r) => setTimeout(r, 800));
      const next = await refresh();
      if (next.hasAccess) showToast('Compras restauradas');
      else setError('Nenhuma compra ativa encontrada para esta conta.');
    } catch (err) {
      setError(friendlyError(err, 'Não foi possível restaurar compras.'));
    } finally {
      setBusy(false);
    }
  }

  if (entitlement.hasAccess && entitlement.source === 'subscription') {
    return (
      <Screen>
        <Typography variant="body">Sua assinatura está ativa.</Typography>
      </Screen>
    );
  }

  return (
    <Screen scroll>
      <View style={{ gap: space.sm }}>
        <Typography variant="pageTitle">
          {entitlement.source === 'trial' && !entitlement.hasAccess
            ? 'Seu período gratuito terminou'
            : 'Continue com o Both Pro'}
        </Typography>
        <Typography variant="body" muted>
          Assine para continuar usando sincronização automática, notificações e resumos por email.
        </Typography>
      </View>

      <View style={{ gap: space.sm }}>
        {FEATURES.map((feature) => (
          <Typography key={feature} variant="body">
            ✓ {feature}
          </Typography>
        ))}
      </View>

      <View
        style={{
          padding: space.lg,
          borderRadius: theme.radius,
          borderWidth: 1,
          borderColor: theme.border,
          backgroundColor: theme.surface,
          gap: space.xs,
        }}
      >
        <Typography variant="sectionTitle">{planName}</Typography>
        {loadingPlan ? (
          <ActivityIndicator color={theme.primary} />
        ) : (
          <Typography variant="pageTitle">{priceLabel ?? (native ? 'Preço na loja' : 'Preço no checkout')}</Typography>
        )}
        <Typography variant="metadata" muted>
          {native
            ? 'Assinatura gerenciada pela App Store / Google Play. O teste gratuito do Both não é um trial da loja.'
            : 'Pagamento seguro via Stripe. Cancele quando quiser.'}
        </Typography>
      </View>

      {error ? (
        <Typography variant="caption" style={{ color: theme.danger }}>
          {error}
        </Typography>
      ) : null}

      <Button
        label={
          busy
            ? native
              ? 'Processando…'
              : 'Abrindo checkout…'
            : native
              ? 'Assinar'
              : 'Continuar com Both'
        }
        onPress={() => void subscribe()}
        loading={busy}
        disabled={loadingPlan}
      />

      {native ? (
        <Button label="Restaurar compras" variant="ghost" onPress={() => void restore()} disabled={busy} />
      ) : null}

      <View style={{ gap: 8, alignItems: 'center' }}>
        <Link href="/(auth)/terms" asChild>
          <Typography variant="metadata" muted>
            Termos de uso
          </Typography>
        </Link>
        <Link href="/(auth)/privacy" asChild>
          <Typography variant="metadata" muted>
            Política de privacidade
          </Typography>
        </Link>
        {Platform.OS === 'ios' ? (
          <Typography
            variant="metadata"
            muted
            onPress={() => void Linking.openURL('https://www.apple.com/legal/internet-services/itunes/dev/stdeula/')}
          >
            Termos de uso da Apple (EULA)
          </Typography>
        ) : null}
      </View>
    </Screen>
  );
}
