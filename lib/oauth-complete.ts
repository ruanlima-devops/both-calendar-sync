export const OAUTH_COMPLETE_STORAGE_KEY = 'both-calendar-oauth-complete';
export const OAUTH_MESSAGE_TYPE = 'unify-calendar-oauth';
export const OAUTH_POPUP_NAME = 'both-calendar-oauth';
export const OAUTH_POPUP_PARAM = 'popup';
export const OAUTH_TICKET_PARAM = 'oauth_ticket';
export const OAUTH_NONCE_KEY_PREFIX = 'both-oauth-nonce:';

type OAuthProviderName = 'google' | 'microsoft';
type KeyValueStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

/** Marks the web return URL so /oauth knows it runs inside the OAuth popup. */
export function withOAuthPopupMarker(redirect: string): string {
  const url = new URL(redirect);
  url.searchParams.set(OAUTH_POPUP_PARAM, '1');
  return url.toString();
}

/** Provider login pages sever window.opener, so the popup is detected by marker or window name. */
export function isOAuthPopupReturn(input: { popupParam?: string | null; windowName?: string | null }): boolean {
  return input.popupParam === '1' || input.windowName === OAUTH_POPUP_NAME;
}

/** Drops the completion ticket from a URL before it lands in browser history. */
export function withoutOAuthTicket(href: string): string {
  const url = new URL(href);
  url.searchParams.delete(OAUTH_TICKET_PARAM);
  return url.toString();
}

/** Client nonce binding the OAuth flow to the browser/app that started it. */
export function encodeClientNonce(bytes: Uint8Array): string {
  if (bytes.length < 16) throw new Error('client nonce needs at least 128 bits');
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function rememberOAuthNonce(storage: KeyValueStorage, provider: OAuthProviderName, nonce: string): void {
  storage.setItem(`${OAUTH_NONCE_KEY_PREFIX}${provider}`, nonce);
}

/** Read-once: the nonce is removed as soon as the flow uses or abandons it. */
export function takeOAuthNonce(storage: KeyValueStorage, provider: OAuthProviderName): string | null {
  const key = `${OAUTH_NONCE_KEY_PREFIX}${provider}`;
  const value = storage.getItem(key);
  storage.removeItem(key);
  return value;
}

export type OAuthCompletePayload = {
  ok: boolean;
  provider: OAuthProviderName | null;
  error: string | null;
  /** Opaque completion ticket; only the window that started the flow can finalize it. */
  ticket?: string | null;
};

export function persistOAuthComplete(payload: OAuthCompletePayload): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(OAUTH_COMPLETE_STORAGE_KEY, JSON.stringify(payload));
}

export function consumeOAuthComplete(
  accept: (payload: OAuthCompletePayload) => boolean = () => true,
): OAuthCompletePayload | null {
  if (typeof window === 'undefined') return null;
  const raw = localStorage.getItem(OAUTH_COMPLETE_STORAGE_KEY);
  if (!raw) return null;
  let payload: OAuthCompletePayload;
  try {
    payload = JSON.parse(raw) as OAuthCompletePayload;
  } catch {
    localStorage.removeItem(OAUTH_COMPLETE_STORAGE_KEY);
    return null;
  }
  if (!accept(payload)) return null;
  localStorage.removeItem(OAUTH_COMPLETE_STORAGE_KEY);
  return payload;
}

export function notifyOAuthOpener(payload: OAuthCompletePayload): boolean {
  if (typeof window === 'undefined') return false;
  if (!window.opener || window.opener.closed || window.opener === window) return false;
  const message = {
    type: OAUTH_MESSAGE_TYPE,
    ok: payload.ok,
    provider: payload.provider,
    error: payload.error,
    ticket: payload.ticket ?? null,
  };
  try {
    window.opener.postMessage(message, window.location.origin);
    return true;
  } catch {
    return false;
  }
}
