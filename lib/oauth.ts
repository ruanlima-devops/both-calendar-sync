import { Platform } from 'react-native';
import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';
import { LEGACY_APP_SCHEME, OAUTH_PATH } from '@/lib/app';
import { invokeFunction } from '@/lib/supabase';

WebBrowser.maybeCompleteAuthSession();

const USER_ERROR = 'Não foi possível conectar o calendário. Tente novamente.';
const MESSAGE_TYPE = 'unify-calendar-oauth';

type OAuthFunctionResponse = {
  authorizationUrl?: string;
  error?: string;
};

function supabaseOrigin(): string | null {
  const raw = process.env.EXPO_PUBLIC_SUPABASE_URL;
  if (!raw) return null;
  try {
    return new URL(raw).origin;
  } catch {
    return null;
  }
}

function waitForPopupResult(provider: 'google' | 'microsoft'): {
  promise: Promise<'ok' | 'error' | 'cancel'>;
  stop: () => void;
} {
  if (Platform.OS !== 'web' || typeof window === 'undefined') {
    return { promise: new Promise(() => {}), stop() {} };
  }
  const allowed = supabaseOrigin();
  let stop = () => {};
  const promise = new Promise<'ok' | 'error' | 'cancel'>((resolve) => {
    const onMessage = (event: MessageEvent) => {
      if (allowed && event.origin !== allowed) return;
      const data = event.data as {
        type?: string;
        ok?: boolean;
        provider?: string;
        error?: string | null;
      } | null;
      if (!data || data.type !== MESSAGE_TYPE) return;
      if (data.provider && data.provider !== provider) return;
      window.removeEventListener('message', onMessage);
      if (data.ok) resolve('ok');
      else if (data.error === 'access_denied') resolve('cancel');
      else resolve('error');
    };
    window.addEventListener('message', onMessage);
    stop = () => window.removeEventListener('message', onMessage);
  });
  return { promise, stop };
}

function errorFromUrl(url: string): string | null {
  const raw = url.match(/[?&]oauth_error=([^&]+)/)?.[1];
  if (!raw) return null;
  try {
    return decodeURIComponent(raw.replace(/\+/g, ' '));
  } catch {
    return raw;
  }
}

function outcomeFromUrl(url: string): 'ok' | 'error' | 'cancel' {
  const error = errorFromUrl(url);
  if (error === 'access_denied') return 'cancel';
  if (error) return 'error';
  if (/[?&]connected=(google|microsoft)/.test(url)) return 'ok';
  return 'error';
}

/**
 * Connect Google/Microsoft Calendar.
 * Web: popup + postMessage race (existing).
 * Native: secure browser → legacy unify://oauth deep link
 * (TODO(rebrand): switch to APP_SCHEME after STAGE/PROD OAuth migration).
 */
export async function connectCalendar(provider: 'google' | 'microsoft'): Promise<void> {
  const redirect = Linking.createURL(OAUTH_PATH, { scheme: LEGACY_APP_SCHEME });
  const data = await invokeFunction<OAuthFunctionResponse>(`${provider}-oauth`, { redirect });
  const authorizationUrl = data.authorizationUrl;
  if (!authorizationUrl) {
    throw new Error(data.error ?? USER_ERROR);
  }

  const popup = waitForPopupResult(provider);
  const session = WebBrowser.openAuthSessionAsync(authorizationUrl, redirect);

  let outcome: 'ok' | 'error' | 'cancel' = 'ok';
  let callbackUrl: string | undefined;
  try {
    if (Platform.OS === 'web') {
      outcome = await Promise.race([
        popup.promise,
        session.then((result) => {
          if (result.type === 'cancel' || result.type === 'dismiss') return 'cancel' as const;
          if (result.type === 'success' && result.url) {
            callbackUrl = result.url;
            return outcomeFromUrl(result.url);
          }
          return 'error' as const;
        }),
      ]);
    } else {
      const result = await session;
      if (result.type === 'cancel' || result.type === 'dismiss') outcome = 'cancel';
      else if (result.type === 'success' && result.url) {
        callbackUrl = result.url;
        outcome = outcomeFromUrl(result.url);
      } else outcome = 'error';
    }
  } finally {
    popup.stop();
  }

  if (outcome === 'cancel') return;
  if (outcome === 'error') {
    const detail = callbackUrl ? errorFromUrl(callbackUrl) : null;
    throw new Error(detail ?? USER_ERROR);
  }
}
