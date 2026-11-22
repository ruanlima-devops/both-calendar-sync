/**
 * GitHub App JWT (RS256) via Web Crypto — Cloudflare Workers compatible.
 * No node:crypto. No network. No side effects on import.
 *
 * Private key must be PKCS#8 (SPKI/PKCS8 PEM or raw base64 DER).
 * GitHub downloads PKCS#1 — convert offline before storing as secret.
 */

export type GithubAppJwtInput = {
  /** App ID or Client ID (iss claim) */
  app_id: string;
  /** PKCS#8 PEM (`-----BEGIN PRIVATE KEY-----`) or base64 DER without headers */
  private_key_pkcs8: string;
  /** Epoch seconds override for tests */
  now_seconds?: number;
  /** JWT lifetime seconds (GitHub max 600) */
  expires_in_seconds?: number;
};

export type GithubAppJwtResult =
  | { ok: true; token: string; exp: number; iat: number }
  | { ok: false; code: string };

const PEM_HEADER = /-----BEGIN PRIVATE KEY-----/;
const PEM_FOOTER = /-----END PRIVATE KEY-----/;
const PKCS1_HEADER = /-----BEGIN RSA PRIVATE KEY-----/;

function b64urlFromBytes(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]!);
  // btoa available in Workers and modern Node
  const b64 = btoa(bin);
  return b64.replace(/=+$/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function b64urlFromJson(obj: unknown): string {
  const json = JSON.stringify(obj);
  return b64urlFromBytes(new TextEncoder().encode(json));
}

/** Reject PKCS#1 / OpenSSH; accept PKCS#8 PEM or base64 DER. */
export function parsePkcs8KeyBytes(raw: string): { ok: true; der: Uint8Array } | { ok: false; code: string } {
  if (raw == null || typeof raw !== 'string' || raw.trim() === '') {
    return { ok: false, code: 'private_key_absent' };
  }
  const text = raw.replace(/\\n/g, '\n').trim();
  if (PKCS1_HEADER.test(text)) {
    return { ok: false, code: 'pkcs1_not_supported_convert_to_pkcs8' };
  }
  if (/BEGIN OPENSSH PRIVATE KEY/.test(text)) {
    return { ok: false, code: 'openssh_key_not_supported' };
  }
  if (PEM_HEADER.test(text)) {
    if (!PEM_FOOTER.test(text)) return { ok: false, code: 'pkcs8_pem_incomplete' };
    const body = text
      .replace(PEM_HEADER, '')
      .replace(PEM_FOOTER, '')
      .replace(/\s+/g, '');
    try {
      const bin = atob(body);
      const der = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) der[i] = bin.charCodeAt(i);
      if (der.length < 32) return { ok: false, code: 'pkcs8_der_too_short' };
      return { ok: true, der };
    } catch {
      return { ok: false, code: 'pkcs8_pem_decode_failed' };
    }
  }
  // raw base64 DER
  try {
    const compact = text.replace(/\s+/g, '');
    if (!/^[A-Za-z0-9+/=]+$/.test(compact)) return { ok: false, code: 'private_key_malformed' };
    const bin = atob(compact);
    const der = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) der[i] = bin.charCodeAt(i);
    if (der.length < 32) return { ok: false, code: 'pkcs8_der_too_short' };
    return { ok: true, der };
  } catch {
    return { ok: false, code: 'private_key_malformed' };
  }
}

export async function importGithubAppPrivateKey(
  private_key_pkcs8: string,
): Promise<{ ok: true; key: CryptoKey } | { ok: false; code: string }> {
  const parsed = parsePkcs8KeyBytes(private_key_pkcs8);
  if (!parsed.ok) return parsed;
  try {
    const key = await crypto.subtle.importKey(
      'pkcs8',
      parsed.der.buffer as ArrayBuffer,
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['sign'],
    );
    return { ok: true, key };
  } catch {
    return { ok: false, code: 'pkcs8_import_failed' };
  }
}

/**
 * Create GitHub App JWT. Does not contact network.
 */
export async function createGithubAppJwt(input: GithubAppJwtInput): Promise<GithubAppJwtResult> {
  if (!input.app_id || typeof input.app_id !== 'string' || input.app_id.length > 64) {
    return { ok: false, code: 'app_id_invalid' };
  }
  if (!/^[A-Za-z0-9_-]+$/.test(input.app_id)) {
    return { ok: false, code: 'app_id_invalid' };
  }

  const expiresIn = input.expires_in_seconds ?? 600;
  if (!Number.isFinite(expiresIn) || expiresIn < 30 || expiresIn > 600) {
    return { ok: false, code: 'expires_in_invalid' };
  }

  const now = input.now_seconds ?? Math.floor(Date.now() / 1000);
  if (!Number.isFinite(now) || now <= 0) return { ok: false, code: 'clock_invalid' };

  const iat = now - 60; // GitHub clock skew guidance
  const exp = now + expiresIn;

  const imported = await importGithubAppPrivateKey(input.private_key_pkcs8);
  if (!imported.ok) return imported;

  const header = b64urlFromJson({ alg: 'RS256', typ: 'JWT' });
  const payload = b64urlFromJson({ iat, exp, iss: input.app_id });
  const unsigned = `${header}.${payload}`;

  try {
    const sig = await crypto.subtle.sign(
      'RSASSA-PKCS1-v1_5',
      imported.key,
      new TextEncoder().encode(unsigned),
    );
    const token = `${unsigned}.${b64urlFromBytes(new Uint8Array(sig))}`;
    return { ok: true, token, exp, iat };
  } catch {
    return { ok: false, code: 'jwt_sign_failed' };
  }
}

/** Redact JWT-like strings for logs. */
export function redactJwtLike(value: string, max = 24): string {
  if (!value) return '';
  if (/^eyJ[A-Za-z0-9_-]+\./.test(value)) return '[redacted_jwt]';
  if (value.length <= max) return '[redacted]';
  return `${value.slice(0, 4)}…[redacted]`;
}
