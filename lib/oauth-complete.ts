export const OAUTH_COMPLETE_STORAGE_KEY = 'both-calendar-oauth-complete';
export const OAUTH_MESSAGE_TYPE = 'unify-calendar-oauth';
export const OAUTH_POPUP_NAME = 'both-calendar-oauth';
export const OAUTH_POPUP_PARAM = 'popup';

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

export type OAuthCompletePayload = {
  ok: boolean;
  provider: 'google' | 'microsoft' | null;
  error: string | null;
};

export function persistOAuthComplete(payload: OAuthCompletePayload): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(OAUTH_COMPLETE_STORAGE_KEY, JSON.stringify(payload));
}

export function consumeOAuthComplete(): OAuthCompletePayload | null {
  if (typeof window === 'undefined') return null;
  const raw = localStorage.getItem(OAUTH_COMPLETE_STORAGE_KEY);
  if (!raw) return null;
  localStorage.removeItem(OAUTH_COMPLETE_STORAGE_KEY);
  try {
    return JSON.parse(raw) as OAuthCompletePayload;
  } catch {
    return null;
  }
}

export function notifyOAuthOpener(payload: OAuthCompletePayload): boolean {
  if (typeof window === 'undefined') return false;
  if (!window.opener || window.opener.closed || window.opener === window) return false;
  const message = {
    type: OAUTH_MESSAGE_TYPE,
    ok: payload.ok,
    provider: payload.provider,
    error: payload.error,
  };
  const targetOrigin = window.location.origin;
  try {
    window.opener.postMessage(message, targetOrigin);
    return true;
  } catch {
    try {
      window.opener.postMessage(message, '*');
      return true;
    } catch {
      return false;
    }
  }
}
