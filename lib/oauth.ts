import { Platform } from 'react-native';
import * as Linking from 'expo-linking';
import { makeRedirectUri } from 'expo-auth-session';
import * as WebBrowser from 'expo-web-browser';
import { APP_SCHEME, OAUTH_PATH } from '@/lib/app';
import { invokeFunction } from '@/lib/supabase';

WebBrowser.maybeCompleteAuthSession();

const USER_ERROR = 'Não foi possível conectar o calendário. Tente novamente.';
const MESSAGE_TYPE = 'unify-calendar-oauth';

type OAuthFunctionResponse = {
  authorizationUrl?: string;
  error?: string;
};

/** Return URL registered in oauth_states and matched after provider callback. */
export function getCalendarOAuthRedirectUri(): string {
  if (Platform.OS === 'web') {
    return makeRedirectUri({ path: OAUTH_PATH });
  }
  return Linking.createURL(OAUTH_PATH, { scheme: APP_SCHEME });
}

function allowedMessageOrigins(): Set<string> {
  const origins = new Set<string>();
  if (typeof window !== 'undefined') {
    origins.add(window.location.origin);
  }
  const supabase = supabaseOrigin();
  if (supabase) origins.add(supabase);
  return origins;
}

function supabaseOrigin(): string | null {
  const raw = process.env.EXPO_PUBLIC_SUPABASE_URL;
  if (!raw) return null;
  try {
    return new URL(raw).origin;
  } catch {
    return null;
  }
}

const WEB_OAUTH_TIMEOUT_MS = 120_000;

function waitForPopupResult(provider: 'google' | 'microsoft'): {
  promise: Promise<{ outcome: 'ok' | 'error' | 'cancel'; error?: string | null }>;
  stop: () => void;
} {
  if (Platform.OS !== 'web' || typeof window === 'undefined') {
    return { promise: new Promise(() => {}), stop() {} };
  }
  const allowed = allowedMessageOrigins();
  let stop = () => {};
  const promise = new Promise<{ outcome: 'ok' | 'error' | 'cancel'; error?: string | null }>(
    (resolve, reject) => {
    const timeout = window.setTimeout(() => {
      window.removeEventListener('message', onMessage);
      reject(new Error(USER_ERROR));
    }, WEB_OAUTH_TIMEOUT_MS);
    const finish = (outcome: 'ok' | 'error' | 'cancel', error?: string | null) => {
      window.clearTimeout(timeout);
      window.removeEventListener('message', onMessage);
      resolve({ outcome, error: error ?? null });
    };
    const onMessage = (event: MessageEvent) => {
      if (allowed.size > 0 && !allowed.has(event.origin)) return;
      const data = event.data as {
        type?: string;
        ok?: boolean;
        provider?: string;
        error?: string | null;
      } | null;
      if (!data || data.type !== MESSAGE_TYPE) return;
      if (data.provider && data.provider !== provider) return;
      if (data.ok) finish('ok');
      else if (data.error === 'access_denied') finish('cancel');
      else finish('error', data.error ?? null);
    };
    window.addEventListener('message', onMessage);
    stop = () => {
      window.clearTimeout(timeout);
      window.removeEventListener('message', onMessage);
    };
  },
  );
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
 * Native: secure browser → variant scheme (`both-dev` / `both-stg` / `both`) `://oauth`.
 * Incoming `unify://oauth` is still accepted for legacy builds.
 */
export async function connectCalendar(provider: 'google' | 'microsoft'): Promise<void> {
  const redirect = getCalendarOAuthRedirectUri();
  const data = await invokeFunction<OAuthFunctionResponse>(`${provider}-oauth`, { redirect });
  const authorizationUrl = data.authorizationUrl;
  if (!authorizationUrl) {
    throw new Error(data.error ?? USER_ERROR);
  }

  const popup = waitForPopupResult(provider);
  let popupError: string | null = null;

  let outcome: 'ok' | 'error' | 'cancel' = 'ok';
  let callbackUrl: string | undefined;
  try {
    if (Platform.OS === 'web') {
      void WebBrowser.openAuthSessionAsync(authorizationUrl, redirect);
      const result = await popup.promise;
      outcome = result.outcome;
      popupError = result.error ?? null;
    } else {
      const session = await WebBrowser.openAuthSessionAsync(authorizationUrl, redirect);
      if (session.type === 'cancel' || session.type === 'dismiss') outcome = 'cancel';
      else if (session.type === 'success' && session.url) {
        callbackUrl = session.url;
        outcome = outcomeFromUrl(session.url);
      } else outcome = 'error';
    }
  } finally {
    popup.stop();
  }

  if (outcome === 'cancel') return;
  if (outcome === 'error') {
    const detail = popupError ?? (callbackUrl ? errorFromUrl(callbackUrl) : null);
    throw new Error(detail ?? USER_ERROR);
  }
}
