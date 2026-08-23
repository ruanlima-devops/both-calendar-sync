import { supabase } from '@/lib/supabase';
import { isCancelledAuth, userMessageForAuthError } from '@/lib/auth/errors';

export const AUTH_CALLBACK_PATH = 'auth/callback';

export interface AuthCallbackParams {
  code?: string;
  flowId?: string;
  accessToken?: string;
  refreshToken?: string;
  error?: string;
  errorDescription?: string;
}

function readParams(url: string): Record<string, string> {
  const collected: Record<string, string> = {};

  const take = (raw: string) => {
    const query = raw.startsWith('?') || raw.startsWith('#') ? raw.slice(1) : raw;
    for (const part of query.split('&')) {
      if (!part) continue;
      const eq = part.indexOf('=');
      const key = eq >= 0 ? part.slice(0, eq) : part;
      const value = eq >= 0 ? part.slice(eq + 1) : '';
      try {
        collected[decodeURIComponent(key)] = decodeURIComponent(value.replace(/\+/g, ' '));
      } catch {
        collected[key] = value;
      }
    }
  };

  const q = url.indexOf('?');
  const h = url.indexOf('#');
  if (q >= 0) take(url.slice(q, h > q ? h : url.length));
  if (h >= 0) take(url.slice(h));
  return collected;
}

export function parseAuthCallbackUrl(url: string): AuthCallbackParams {
  const params = readParams(url);
  return {
    code: params.code,
    flowId: params.sb_flow_id ?? params.flow_id,
    accessToken: params.access_token,
    refreshToken: params.refresh_token,
    error: params.error,
    errorDescription: params.error_description,
  };
}

export async function createSessionFromUrl(url: string): Promise<'success' | 'ignored'> {
  const existing = await supabase.auth.getSession();
  if (existing.data.session) return 'success';

  const params = parseAuthCallbackUrl(url);

  if (params.error) {
    const combined = `${params.error} ${params.errorDescription ?? ''}`;
    if (isCancelledAuth(combined)) return 'ignored';
    throw new Error(userMessageForAuthError(combined));
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

  return 'ignored';
}
