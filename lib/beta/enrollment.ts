import { supabase } from '@/lib/supabase';

/** Client helper — never trusts itself for enforcement; server RPC/settings are source of truth. */
export async function fetchBetaEnrollmentRequired(): Promise<boolean> {
  const { data } = await supabase
    .from('billing_settings')
    .select('value')
    .eq('key', 'beta_enrollment_required')
    .maybeSingle();
  return String(data?.value ?? 'false') === 'true';
}

export async function redeemBetaInvite(code: string): Promise<{ ok: boolean; error?: string }> {
  const { data, error } = await supabase.rpc('redeem_beta_invite', { p_code: code });
  if (error) return { ok: false, error: 'request_failed' };
  const payload = data as { ok?: boolean; error?: string } | null;
  if (!payload?.ok) return { ok: false, error: payload?.error ?? 'invite_not_found' };
  return { ok: true };
}
