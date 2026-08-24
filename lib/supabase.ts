import { createClient } from '@supabase/supabase-js';
import Constants from 'expo-constants';
import { Platform } from 'react-native';
import { createAuthStorage } from '@/lib/auth/storage';
import { environmentWarnings } from '@/lib/environment';

const url = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
const anon = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';

if (__DEV__) {
  const extra = (Constants.expoConfig?.extra ?? {}) as { appVariant?: string };
  for (const warning of environmentWarnings({
    variant: extra.appVariant ?? process.env.APP_VARIANT,
    supabaseUrl: url,
  })) {
    console.warn(`[both-env] ${warning}`);
  }
}

const isWebServer = Platform.OS === 'web' && typeof window === 'undefined';

export const supabase = createClient(url, anon, {
  auth: {
    storage: createAuthStorage(),
    autoRefreshToken: !isWebServer,
    persistSession: !isWebServer,
    detectSessionInUrl: Platform.OS === 'web' && !isWebServer,
    flowType: 'pkce',
  },
});

export async function invokeFunction<T>(name: string, body?: Record<string, unknown>): Promise<T> {
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData.session?.access_token;
  const { data, error } = await supabase.functions.invoke(name, {
    body,
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  });
  if (error) {
    let detail = error.message || `Falha ao chamar ${name}`;
    const context = (error as { context?: Response }).context;
    if (context) {
      try {
        const payload = (await context.json()) as { error?: unknown; msg?: unknown; message?: unknown };
        const extracted = payload.error ?? payload.msg ?? payload.message;
        if (typeof extracted === 'string' && extracted.length > 0) detail = extracted;
      } catch {
        /* keep gateway message */
      }
    }
    throw new Error(detail);
  }
  return data as T;
}
