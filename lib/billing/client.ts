import { supabase } from '@/lib/supabase';
import type { PlanPrice } from '@/lib/billing/entitlement';

export interface BillingPlanInfo {
  plan: { id: string; name: string; interval: string; currency: string };
  price: PlanPrice | null;
  stripeConfigured: boolean;
}

export async function fetchBillingPlan(): Promise<BillingPlanInfo> {
  const { data, error } = await supabase.functions.invoke('billing-checkout', { method: 'GET' });
  if (error) throw new Error(error.message);
  return data as BillingPlanInfo;
}

export async function startCheckout(): Promise<string> {
  const { data, error } = await supabase.functions.invoke<{ url?: string; error?: string }>('billing-checkout');
  if (error) throw new Error(error.message);
  if (!data?.url) throw new Error(data?.error ?? 'CHECKOUT_FAILED');
  await supabase.from('product_events').insert({ name: 'checkout_started' });
  return data.url;
}

export async function openBillingPortal(): Promise<string> {
  const { data, error } = await supabase.functions.invoke<{ url?: string; error?: string }>('billing-portal');
  if (error) throw new Error(error.message);
  if (!data?.url) throw new Error(data?.error ?? 'PORTAL_FAILED');
  return data.url;
}
