const encoder = new TextEncoder();
const decoder = new TextDecoder();

function bytesToB64(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

function b64ToBytes(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

async function importKey(rawB64: string): Promise<CryptoKey> {
  const raw = b64ToBytes(rawB64);
  if (raw.byteLength !== 32) {
    throw new Error('TOKEN_ENCRYPTION_KEY must be 32 bytes (base64)');
  }
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

export async function encryptSecret(plaintext: string, keyB64: string): Promise<string> {
  const key = await importKey(keyB64);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    encoder.encode(plaintext),
  );
  const packed = new Uint8Array(iv.byteLength + cipher.byteLength);
  packed.set(iv, 0);
  packed.set(new Uint8Array(cipher), iv.byteLength);
  return bytesToB64(packed);
}

export async function decryptSecret(payload: string, keyB64: string): Promise<string> {
  const key = await importKey(keyB64);
  const packed = b64ToBytes(payload);
  const iv = packed.slice(0, 12);
  const data = packed.slice(12);
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, data);
  return decoder.decode(plain);
}

export function needsRefresh(expiresAtIso: string | null | undefined, now = new Date(), skewMs = 60_000): boolean {
  if (!expiresAtIso) return true;
  return new Date(expiresAtIso).getTime() <= now.getTime() + skewMs;
}

const AUTH_OAUTH_CODES = new Set([
  'invalid_grant',
  'invalid_token',
  'unauthorized_client',
  'interaction_required',
  'consent_required',
  'login_required',
  'expired_token',
]);

export function mapOAuthError(status: number, errorCode?: string): 'AUTH_REQUIRED' | 'ERROR' {
  if (status === 400 || status === 401) {
    if (!errorCode || AUTH_OAUTH_CODES.has(errorCode)) {
      return 'AUTH_REQUIRED';
    }
    // Token endpoint 400/401 without a known transient code still means re-auth.
    return 'AUTH_REQUIRED';
  }
  return 'ERROR';
}

/** True when refresh/API failure requires user reconnect (not rate-limit / outage). */
export function isAuthRequiredError(err: unknown): boolean {
  if (err && typeof err === 'object') {
    const e = err as { status?: unknown; code?: unknown };
    if (e.status === 'AUTH_REQUIRED' || e.code === 'AUTH_REQUIRED') return true;
  }
  const message = String(err instanceof Error ? err.message : err);
  if (
    message.includes('invalid_grant') ||
    message.includes('invalid_token') ||
    message.includes('icloud_auth_failed') ||
    message.includes('interaction_required') ||
    message.includes('consent_required')
  ) {
    return true;
  }
  // Common Microsoft identity revocation / expired grant codes in error text.
  return /AADSTS(50173|70008|70000|700082|50076|50079)/i.test(message);
}

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(value));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export function toBase64Url(b64: string): string {
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

export function fromBase64Url(value: string): string {
  const b64 = value.replace(/-/g, '+').replace(/_/g, '/');
  const pad = b64.length % 4 === 0 ? '' : '='.repeat(4 - (b64.length % 4));
  return b64 + pad;
}

export function randomHex(bytes = 32): string {
  const arr = crypto.getRandomValues(new Uint8Array(bytes));
  return Array.from(arr)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return out === 0;
}
