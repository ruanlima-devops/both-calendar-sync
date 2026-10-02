import { Platform } from 'react-native';
import * as Linking from 'expo-linking';
import { makeRedirectUri } from 'expo-auth-session';
import * as Crypto from 'expo-crypto';
import * as WebBrowser from 'expo-web-browser';
import { APP_SCHEME, OAUTH_PATH } from '@/lib/app';
import {
  consumeOAuthComplete,
  encodeClientNonce,
  OAUTH_MESSAGE_TYPE,
  OAUTH_POPUP_NAME,
  OAUTH_TICKET_PARAM,
  rememberOAuthNonce,
  takeOAuthNonce,
  withOAuthPopupMarker,
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

type PopupResult = { outcome: 'ok' | 'error' | 'cancel'; error?: string | null; ticket?: string | null };

/** Web keeps the client nonce in this tab's sessionStorage; native keeps it in memory only. */
function nonceStorage(): Storage | null {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return null;
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

/** Return URL registered in oauth_states and matched after provider callback. */
export function getCalendarOAuthRedirectUri(): string {
  if (Platform.OS === 'web') {
    return withOAuthPopupMarker(makeRedirectUri({ path: OAUTH_PATH }));
  }
  return Linking.createURL(OAUTH_PATH, { scheme: APP_SCHEME });
}

function openWebOAuthPopup(url: string): Window | null {
  if (typeof window === 'undefined') return null;
  const width = 520;
  const height = 720;
  const left = window.screenX + Math.max(0, (window.outerWidth - width) / 2);
  const top = window.screenY + Math.max(0, (window.outerHeight - height) / 2);
  return window.open(
    url,
    OAUTH_POPUP_NAME,
    `popup=yes,toolbar=no,menubar=no,width=${width},height=${height},left=${left},top=${top}`,
  );
}

function payloadToResult(payload: OAuthCompletePayload, provider: 'google' | 'microsoft'): PopupResult {
  if (payload.provider && payload.provider !== provider) {
    return { outcome: 'error', error: 'provider_mismatch' };
  }
  if (payload.ok) return { outcome: 'ok', ticket: payload.ticket ?? null };
  if (payload.error === 'access_denied') return { outcome: 'cancel' };
  return { outcome: 'error', error: payload.error };
}

function waitForWebOAuthResult(
  provider: 'google' | 'microsoft',
  popupWindow: Window | null,
): { promise: Promise<PopupResult>; stop: () => void } {
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
      if (event.origin !== window.location.origin) return;
      const data = event.data as {
        type?: string;
        ok?: boolean;
        provider?: string;
        error?: string | null;
        ticket?: string | null;
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
        ticket: data.ticket ?? null,
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

function queryParam(url: string, name: string): string | null {
  const raw = url.match(new RegExp(`[?&]${name}=([^&#]+)`))?.[1];
  if (!raw) return null;
  try {
    return decodeURIComponent(raw.replace(/\+/g, ' '));
  } catch {
    return raw;
  }
}

function outcomeFromUrl(url: string): 'ok' | 'error' | 'cancel' {
  const error = queryParam(url, 'oauth_error');
  if (error === 'access_denied') return 'cancel';
  if (error) return 'error';
  if (queryParam(url, OAUTH_TICKET_PARAM)) return 'ok';
  return 'error';
}

/** Authenticated finalize: the backend checks user, client nonce, provider and ticket before connecting. */
export async function finalizeCalendarOAuth(
  provider: 'google' | 'microsoft',
  ticket: string,
  clientNonce: string,
): Promise<void> {
  await invokeFunction(`${provider}-oauth`, { action: 'finalize', ticket, client_nonce: clientNonce });
}

/**
 * Connect Google/Microsoft Calendar.
 * Web: dedicated popup + postMessage/localStorage bridge.
 * Native: secure browser → variant scheme (`both-dev` / `both-stg` / `both`) `://oauth`.
 * The provider callback only issues a completion ticket; this window finalizes it.
 */
export async function connectCalendar(provider: 'google' | 'microsoft'): Promise<'connected' | 'cancelled'> {
  const redirect = getCalendarOAuthRedirectUri();
  const clientNonce = encodeClientNonce(await Crypto.getRandomBytesAsync(32));
  const data = await invokeFunction<OAuthFunctionResponse>(`${provider}-oauth`, {
    redirect,
    client_nonce: clientNonce,
  });
  const authorizationUrl = data.authorizationUrl;
  if (!authorizationUrl) {
    throw new Error(data.error ?? USER_ERROR);
  }

  let outcome: 'ok' | 'error' | 'cancel' = 'ok';
  let popupError: string | null = null;
  let callbackUrl: string | undefined;
  let ticket: string | null = null;
  let boundNonce: string | null = clientNonce;

  if (Platform.OS === 'web') {
    const popupWindow = openWebOAuthPopup(authorizationUrl);
    if (!popupWindow) {
      throw new Error(WEB_POPUP_BLOCKED);
    }
    const storage = nonceStorage();
    if (storage) rememberOAuthNonce(storage, provider, clientNonce);
    const waiter = waitForWebOAuthResult(provider, popupWindow);
    try {
      const result = await waiter.promise;
      outcome = result.outcome;
      popupError = result.error ?? null;
      ticket = result.ticket ?? null;
    } finally {
      waiter.stop();
      if (storage) boundNonce = takeOAuthNonce(storage, provider);
    }
  } else {
    const session = await WebBrowser.openAuthSessionAsync(authorizationUrl, redirect);
    if (session.type === 'cancel' || session.type === 'dismiss') outcome = 'cancel';
    else if (session.type === 'success' && session.url) {
      callbackUrl = session.url;
      outcome = outcomeFromUrl(session.url);
      ticket = queryParam(session.url, OAUTH_TICKET_PARAM);
    } else outcome = 'error';
  }

  if (outcome === 'cancel') return 'cancelled';
  if (outcome === 'error') {
    const detail = popupError ?? (callbackUrl ? queryParam(callbackUrl, 'oauth_error') : null);
    throw new Error(detail ?? USER_ERROR);
  }
  if (!ticket || !boundNonce) throw new Error('invalid_ticket');
  await finalizeCalendarOAuth(provider, ticket, boundNonce);
  return 'connected';
}
