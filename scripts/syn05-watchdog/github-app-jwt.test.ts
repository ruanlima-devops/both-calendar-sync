/**
 * GitHub App JWT Web Crypto — offline negatives. No network.
 */

import { describe, expect, it } from 'vitest';
import {
  createGithubAppJwt,
  parsePkcs8KeyBytes,
  redactJwtLike,
} from './github-app-jwt.ts';

async function generatePkcs8Pem(): Promise<string> {
  const pair = await crypto.subtle.generateKey(
    {
      name: 'RSASSA-PKCS1-v1_5',
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: 'SHA-256',
    },
    true,
    ['sign', 'verify'],
  );
  const der = new Uint8Array(await crypto.subtle.exportKey('pkcs8', pair.privateKey));
  let bin = '';
  for (let i = 0; i < der.length; i++) bin += String.fromCharCode(der[i]!);
  const b64 = btoa(bin);
  const lines = b64.match(/.{1,64}/g) ?? [b64];
  return `-----BEGIN PRIVATE KEY-----\n${lines.join('\n')}\n-----END PRIVATE KEY-----`;
}

describe('PKCS#8 parse', () => {
  it('rejects absent key', () => {
    expect(parsePkcs8KeyBytes('').ok).toBe(false);
  });

  it('rejects PKCS#1', () => {
    const r = parsePkcs8KeyBytes(
      '-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA\n-----END RSA PRIVATE KEY-----',
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('pkcs1_not_supported_convert_to_pkcs8');
  });

  it('rejects OpenSSH', () => {
    const r = parsePkcs8KeyBytes('-----BEGIN OPENSSH PRIVATE KEY-----\nabc\n-----END OPENSSH PRIVATE KEY-----');
    expect(r.ok).toBe(false);
  });

  it('accepts generated PKCS#8 PEM', async () => {
    const pem = await generatePkcs8Pem();
    expect(parsePkcs8KeyBytes(pem).ok).toBe(true);
  });
});

describe('createGithubAppJwt', () => {
  it('signs RS256 JWT offline', async () => {
    const pem = await generatePkcs8Pem();
    const r = await createGithubAppJwt({
      app_id: '123456',
      private_key_pkcs8: pem,
      now_seconds: 1_700_000_000,
      expires_in_seconds: 600,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.token.split('.')).toHaveLength(3);
      expect(r.token.startsWith('eyJ')).toBe(true);
      expect(r.exp).toBe(1_700_000_000 + 600);
    }
  });

  it('rejects invalid app id', async () => {
    const pem = await generatePkcs8Pem();
    const r = await createGithubAppJwt({ app_id: 'bad id!', private_key_pkcs8: pem });
    expect(r.ok).toBe(false);
  });

  it('rejects missing key', async () => {
    const r = await createGithubAppJwt({ app_id: '1', private_key_pkcs8: '' });
    expect(r.ok).toBe(false);
  });

  it('rejects expires_in > 600', async () => {
    const pem = await generatePkcs8Pem();
    const r = await createGithubAppJwt({
      app_id: '1',
      private_key_pkcs8: pem,
      expires_in_seconds: 601,
    });
    expect(r.ok).toBe(false);
  });

  it('rejects malformed PKCS#8 bytes', async () => {
    const r = await createGithubAppJwt({
      app_id: '1',
      private_key_pkcs8: btoa('not-a-real-key-material-xxxxxx'),
    });
    expect(r.ok).toBe(false);
  });
});

describe('redaction', () => {
  it('redacts jwt-like', () => {
    expect(redactJwtLike('eyJhbGciOiJSUzI1NiJ9.abc.def')).toBe('[redacted_jwt]');
  });
});
