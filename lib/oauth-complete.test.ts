import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  consumeOAuthComplete,
  isOAuthPopupReturn,
  notifyOAuthOpener,
  OAUTH_COMPLETE_STORAGE_KEY,
  OAUTH_POPUP_NAME,
  persistOAuthComplete,
  withOAuthPopupMarker,
} from './oauth-complete';

function memoryStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
  };
}

afterEach(() => vi.unstubAllGlobals());

describe('web OAuth popup return', () => {
  it('marks the web redirect so /oauth can detect the popup', () => {
    expect(withOAuthPopupMarker('http://localhost:8081/oauth')).toBe('http://localhost:8081/oauth?popup=1');
    expect(withOAuthPopupMarker('https://app.example.test/oauth?x=1')).toBe('https://app.example.test/oauth?x=1&popup=1');
  });

  it('detects the popup by marker or window name even without window.opener', () => {
    expect(isOAuthPopupReturn({ popupParam: '1', windowName: '' })).toBe(true);
    expect(isOAuthPopupReturn({ popupParam: undefined, windowName: OAUTH_POPUP_NAME })).toBe(true);
    expect(isOAuthPopupReturn({ popupParam: undefined, windowName: '' })).toBe(false);
  });

  it('hands the result to the opener through storage once, without tokens', () => {
    vi.stubGlobal('window', {});
    vi.stubGlobal('localStorage', memoryStorage());
    persistOAuthComplete({ ok: true, provider: 'google', error: null });
    expect(localStorage.getItem(OAUTH_COMPLETE_STORAGE_KEY)).toBe('{"ok":true,"provider":"google","error":null}');
    expect(consumeOAuthComplete()).toEqual({ ok: true, provider: 'google', error: null });
    expect(consumeOAuthComplete()).toBeNull();
  });

  it('reports no delivery when the provider severed window.opener', () => {
    vi.stubGlobal('window', { opener: null, location: { origin: 'http://localhost:8081' } });
    expect(notifyOAuthOpener({ ok: false, provider: 'microsoft', error: 'access_denied' })).toBe(false);
  });

  it('posts the result to a live same-origin opener', () => {
    const postMessage = vi.fn();
    const self = { opener: { closed: false, postMessage }, location: { origin: 'http://localhost:8081' } };
    vi.stubGlobal('window', self);
    expect(notifyOAuthOpener({ ok: true, provider: 'microsoft', error: null })).toBe(true);
    expect(postMessage).toHaveBeenCalledWith(
      { type: 'unify-calendar-oauth', ok: true, provider: 'microsoft', error: null },
      'http://localhost:8081',
    );
  });
});
