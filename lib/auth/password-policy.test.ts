import { describe, expect, it } from 'vitest';
import {
  evaluatePassword,
  isValidEmailFormat,
  normalizeEmail,
  passwordsMatch,
} from './password-policy.ts';

describe('password-policy', () => {
  it('rejects short passwords', () => {
    const result = evaluatePassword('Ab1');
    expect(result.ok).toBe(false);
    expect(result.requirements.find((r) => r.id === 'length')?.met).toBe(false);
  });

  it('accepts strong enough passwords', () => {
    expect(evaluatePassword('Senha123').ok).toBe(true);
  });

  it('requires letter and number', () => {
    expect(evaluatePassword('abcdefgh').ok).toBe(false);
    expect(evaluatePassword('12345678').ok).toBe(false);
  });

  it('matches confirm password', () => {
    expect(passwordsMatch('Senha123', 'Senha123')).toBe(true);
    expect(passwordsMatch('Senha123', 'Senha124')).toBe(false);
  });

  it('validates and normalizes e-mail', () => {
    expect(isValidEmailFormat('  a@b.co ')).toBe(true);
    expect(isValidEmailFormat('not-an-email')).toBe(false);
    expect(normalizeEmail('  Foo@Both.COM ')).toBe('foo@both.com');
  });
});
