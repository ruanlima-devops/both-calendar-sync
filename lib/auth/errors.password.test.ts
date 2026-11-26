import { describe, expect, it } from 'vitest';
import {
  AUTH_MESSAGES,
  classifyAuthError,
  userMessageForAuthError,
  userMessageForSignUpResult,
} from './errors.ts';

describe('auth error classification (password)', () => {
  it('classifies unverified e-mail', () => {
    expect(classifyAuthError(new Error('Email not confirmed'))).toBe('EMAIL_UNVERIFIED');
    expect(userMessageForAuthError(new Error('Email not confirmed'), 'password')).toBe(
      AUTH_MESSAGES.emailUnverified,
    );
  });

  it('classifies invalid credentials without leaking existence', () => {
    expect(classifyAuthError(new Error('Invalid login credentials'))).toBe('AUTH_FAILED');
    expect(userMessageForAuthError(new Error('Invalid login credentials'), 'password')).toBe(
      AUTH_MESSAGES.authFailed,
    );
  });

  it('classifies rate limits', () => {
    expect(classifyAuthError({ message: 'rate limit exceeded', status: 429 })).toBe('RATE_LIMITED');
  });

  it('uses anti-enumeration copy for signup conflicts', () => {
    expect(userMessageForSignUpResult('IDENTITY_CONFLICT')).toBe(AUTH_MESSAGES.signupCheckEmail);
    expect(userMessageForSignUpResult('ok')).toBe(AUTH_MESSAGES.signupCheckEmail);
  });

  it('keeps Google fallback for platform errors in google context', () => {
    expect(userMessageForAuthError(new Error('weird'), 'google')).toBe(AUTH_MESSAGES.googleFailed);
  });
});
