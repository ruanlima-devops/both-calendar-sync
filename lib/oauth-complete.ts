export const OAUTH_COMPLETE_STORAGE_KEY = 'both-calendar-oauth-complete';
export const OAUTH_MESSAGE_TYPE = 'unify-calendar-oauth';

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
