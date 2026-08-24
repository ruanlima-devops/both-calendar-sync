import { Platform } from 'react-native';
import * as Linking from 'expo-linking';
import { makeRedirectUri } from 'expo-auth-session';
import * as WebBrowser from 'expo-web-browser';
import { APP_SCHEME, OAUTH_PATH } from '@/lib/app';
import {
  consumeOAuthComplete,
  OAUTH_MESSAGE_TYPE,
  type OAuthCompletePayload,
} from '@/lib/oauth-complete';
import { invokeFunction } from '@/lib/supabase';

WebBrowser.maybeCompleteAuthSession();

const USER_ERROR = 'Não foi possível conectar o calendário. Tente novamente.';
const WEB_OAUTH_TIMEOUT_MS = 120_000;
const WEB_POPUP_BLOCKED =
  'Permita pop-ups neste site para conectar calendários (Both → Configurações do navegador).';

type OAuthFunctionResponse = {
  authorizationUrl?: string;
  error?: string;
};

type PopupResult = { outcome: 'ok' | 'error' | 'cancel'; error?: string | null };

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

function openWebOAuthPopup(url: string): Window | null {
  if (typeof window === 'undefined') return null;
  const width = 520;
  const height = 720;
  const left = window.screenX + Math.max(0, (window.outerWidth - width) / 2);
  const top = window.screenY + Math.max(0, (window.outerHeight - height) / 2);
  return window.open(
    url,
    'both-calendar-oauth',
    `popup=yes,toolbar=no,menubar=no,width=${width},height=${height},left=${left},top=${top}`,
  );
}

function payloadToResult(payload: OAuthCompletePayload, provider: 'google' | 'microsoft'): PopupResult {
  if (payload.provider && payload.provider !== provider) {
    return { outcome: 'error', error: 'provider_mismatch' };
  }
  if (payload.ok) return { outcome: 'ok' };
  if (payload.error === 'access_denied') return { outcome: 'cancel' };
  return { outcome: 'error', error: payload.error };
}

function waitForWebOAuthResult(
  provider: 'google' | 'microsoft',
  popupWindow: Window | null,
): { promise: Promise<PopupResult>; stop: () => void } {
  const allowed = allowedMessageOrigins();
  let storageTimer: number | undefined;
  let popupTimer: number | undefined;
  let stop = () => {};

  const promise = new Promise<PopupResult>((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      cleanup();
      reject(new Error(USER_ERROR));
    }, WEB_OAUTH_TIMEOUT_MS);

    const finish = (result: PopupResult) => {
      cleanup();
      window.clearTimeout(timeout);
      resolve(result);
    };

    const onMessage = (event: MessageEvent) => {
      if (allowed.size > 0 && !allowed.has(event.origin)) return;
      const data = event.data as {
        type?: string;
        ok?: boolean;
        provider?: string;
        error?: string | null;
      } | null;
      if (!data || data.type !== OAUTH_MESSAGE_TYPE) return;
      if (data.provider && data.provider !== provider) return;
      try {
        popupWindow?.close();
      } catch {
        /* ignore */
      }
      finish(payloadToResult({
        ok: Boolean(data.ok),
        provider: (data.provider as OAuthCompletePayload['provider']) ?? provider,
        error: data.error ?? null,
      }, provider));
    };

    storageTimer = window.setInterval(() => {
      const payload = consumeOAuthComplete();
      if (!payload) return;
      try {
        popupWindow?.close();
      } catch {
        /* ignore */
      }
      finish(payloadToResult(payload, provider));
    }, 250);

    if (popupWindow) {
      popupTimer = window.setInterval(() => {
        if (!popupWindow.closed) return;
        const payload = consumeOAuthComplete();
        if (payload) {
          finish(payloadToResult(payload, provider));
          return;
        }
        finish({ outcome: 'cancel' });
      }, 400);
    }

    function cleanup() {
      window.removeEventListener('message', onMessage);
      if (storageTimer !== undefined) window.clearInterval(storageTimer);
      if (popupTimer !== undefined) window.clearInterval(popupTimer);
    }

    window.addEventListener('message', onMessage);
    stop = cleanup;
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
 * Web: dedicated popup + postMessage/localStorage bridge.
 * Native: secure browser → variant scheme (`both-dev` / `both-stg` / `both`) `://oauth`.
 */
export async function connectCalendar(provider: 'google' | 'microsoft'): Promise<void> {
  const redirect = getCalendarOAuthRedirectUri();
  const data = await invokeFunction<OAuthFunctionResponse>(`${provider}-oauth`, { redirect });
  const authorizationUrl = data.authorizationUrl;
  if (!authorizationUrl) {
    throw new Error(data.error ?? USER_ERROR);
  }

  let outcome: 'ok' | 'error' | 'cancel' = 'ok';
  let popupError: string | null = null;
  let callbackUrl: string | undefined;

  if (Platform.OS === 'web') {
    const popupWindow = openWebOAuthPopup(authorizationUrl);
    if (!popupWindow) {
      throw new Error(WEB_POPUP_BLOCKED);
    }
    const waiter = waitForWebOAuthResult(provider, popupWindow);
    try {
      const result = await waiter.promise;
      outcome = result.outcome;
      popupError = result.error ?? null;
    } finally {
      waiter.stop();
    }
  } else {
    const session = await WebBrowser.openAuthSessionAsync(authorizationUrl, redirect);
    if (session.type === 'cancel' || session.type === 'dismiss') outcome = 'cancel';
    else if (session.type === 'success' && session.url) {
      callbackUrl = session.url;
      outcome = outcomeFromUrl(session.url);
    } else outcome = 'error';
  }

  if (outcome === 'cancel') return;
  if (outcome === 'error') {
    const detail = popupError ?? (callbackUrl ? errorFromUrl(callbackUrl) : null);
    throw new Error(detail ?? USER_ERROR);
  }
}
