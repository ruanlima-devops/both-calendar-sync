import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  consumeOAuthComplete,
  encodeClientNonce,
  isOAuthPopupReturn,
  notifyOAuthOpener,
  OAUTH_COMPLETE_STORAGE_KEY,
  OAUTH_POPUP_NAME,
  persistOAuthComplete,
  rememberOAuthNonce,
  takeOAuthNonce,
  withOAuthPopupMarker,
  withoutOAuthTicket,
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

  it('posts the result to a live same-origin opener only', () => {
    const postMessage = vi.fn();
    const self = { opener: { closed: false, postMessage }, location: { origin: 'http://localhost:8081' } };
    vi.stubGlobal('window', self);
    expect(notifyOAuthOpener({ ok: true, provider: 'microsoft', error: null, ticket: 'T' })).toBe(true);
    expect(postMessage).toHaveBeenCalledTimes(1);
    expect(postMessage).toHaveBeenCalledWith(
      { type: 'unify-calendar-oauth', ok: true, provider: 'microsoft', error: null, ticket: 'T' },
      'http://localhost:8081',
    );
  });

  it('never falls back to a wildcard origin (the message carries the completion ticket)', () => {
    const postMessage = vi.fn((_m: unknown, origin: string) => {
      if (origin !== '*') throw new Error('blocked');
    });
    vi.stubGlobal('window', { opener: { closed: false, postMessage }, location: { origin: 'http://localhost:8081' } });
    expect(notifyOAuthOpener({ ok: true, provider: 'google', error: null, ticket: 'T' })).toBe(false);
    expect(postMessage.mock.calls.map((c) => c[1])).toEqual(['http://localhost:8081']);
  });

  it('leaves a ticket payload for the starting window when the reader only accepts finished results', () => {
    vi.stubGlobal('window', {});
    vi.stubGlobal('localStorage', memoryStorage());
    persistOAuthComplete({ ok: true, provider: 'google', error: null, ticket: 'T' });
    expect(consumeOAuthComplete((p) => !p.ticket)).toBeNull();
    expect(consumeOAuthComplete()).toMatchObject({ ticket: 'T' });
  });

  it('removes the completion ticket from the URL kept in history', () => {
    expect(withoutOAuthTicket('http://localhost:8081/oauth?popup=1&oauth_ticket=abc&provider=google'))
      .toBe('http://localhost:8081/oauth?popup=1&provider=google');
  });
});

describe('client nonce', () => {
  it('encodes at least 128 random bits and refuses less', () => {
    expect(encodeClientNonce(new Uint8Array(32).fill(255))).toMatch(/^[0-9a-f]{64}$/);
    expect(encodeClientNonce(new Uint8Array(16))).toHaveLength(32);
    expect(() => encodeClientNonce(new Uint8Array(15))).toThrow();
  });

  it('is kept per provider in the tab storage and read only once', () => {
    const storage = memoryStorage();
    rememberOAuthNonce(storage, 'google', 'nonce-g');
    rememberOAuthNonce(storage, 'microsoft', 'nonce-m');
    expect(takeOAuthNonce(storage, 'google')).toBe('nonce-g');
    expect(takeOAuthNonce(storage, 'google')).toBeNull();
    expect(takeOAuthNonce(storage, 'microsoft')).toBe('nonce-m');
  });
});
