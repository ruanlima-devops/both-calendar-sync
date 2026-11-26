import type { EmailOtpType } from '@supabase/supabase-js';
import { parseAuthCallbackUrl } from '@/lib/auth/callback-url';
import { isCancelledAuth, userMessageForAuthError } from '@/lib/auth/errors';
import { supabase } from '@/lib/supabase';

export { AUTH_CALLBACK_PATH, parseAuthCallbackUrl } from '@/lib/auth/callback-url';
export type { AuthCallbackParams } from '@/lib/auth/callback-url';

const EMAIL_OTP_TYPES = new Set<string>([
  'signup',
  'invite',
  'magiclink',
  'recovery',
  'email_change',
  'email',
]);

export async function createSessionFromUrl(url: string): Promise<'success' | 'ignored'> {
  const params = parseAuthCallbackUrl(url);

  if (params.error) {
    const combined = `${params.error} ${params.errorDescription ?? ''}`;
    if (isCancelledAuth(combined)) return 'ignored';
    throw new Error(userMessageForAuthError(combined));
  }

  // Email confirm / recovery templates redirect with token_hash + type (not PKCE code).
  // Must run even if another browser session exists — otherwise confirm is skipped.
  if (params.tokenHash && params.type && EMAIL_OTP_TYPES.has(params.type)) {
    const { error } = await supabase.auth.verifyOtp({
      token_hash: params.tokenHash,
      type: params.type as EmailOtpType,
    });
    if (error) throw error;
    return 'success';
  }

  if (params.code) {
    const { error } = await supabase.auth.exchangeCodeForSession(
      params.code,
      params.flowId ? { flowId: params.flowId } : undefined,
    );
    if (error) throw error;
    return 'success';
  }

  if (params.accessToken && params.refreshToken) {
    const { error } = await supabase.auth.setSession({
      access_token: params.accessToken,
      refresh_token: params.refreshToken,
    });
    if (error) throw error;
    return 'success';
  }

  const existing = await supabase.auth.getSession();
  if (existing.data.session) return 'success';

  return 'ignored';
}
