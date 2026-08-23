import { describe, expect, it } from 'vitest';
import { isDeltaLinkInvalid } from '../sync/engine.ts';
import {
  inspectMicrosoftClientId,
  microsoftValidationToken,
  MicrosoftCalendarProvider,
  parseMicrosoftEvent,
} from './microsoft.ts';

describe('inspectMicrosoftClientId', () => {
  it('accepts an Application (client) ID UUID', () => {
    const result = inspectMicrosoftClientId('20407466-bbfb-4193-ba10-b77e5c37d11f');
    expect(result.isUuid).toBe(true);
    expect(result.looksLikeSecret).toBe(false);
  });

  it('flags a secret value', () => {
    const result = inspectMicrosoftClientId('abc~secretvaluewithmorethan36characters');
    expect(result.isUuid).toBe(false);
    expect(result.looksLikeSecret).toBe(true);
  });
});

describe('parseMicrosoftEvent', () => {
  it('keeps all-day events on the original date', () => {
    const event = parseMicrosoftEvent({
      id: 'e1',
      subject: 'MS CREATE AUTO 001',
      isAllDay: true,
      start: { dateTime: '2026-08-20T00:00:00.0000000', timeZone: 'America/Sao_Paulo' },
      end: { dateTime: '2026-08-21T00:00:00.0000000', timeZone: 'America/Sao_Paulo' },
    }, 'America/Sao_Paulo');
    expect(event.allDay).toBe(true);
    expect(event.title).toBe('MS CREATE AUTO 001');
    expect(event.startAt.startsWith('2026-08-20')).toBe(true);
    expect(event.isDeleted).toBe(false);
  });

  it('marks removed delta rows as deleted', () => {
    const event = parseMicrosoftEvent({
      id: 'e2',
      subject: 'MS DELETE AUTO 001',
      '@removed': { reason: 'deleted' },
      start: { dateTime: '2026-08-20T15:00:00.0000000', timeZone: 'UTC' },
      end: { dateTime: '2026-08-20T16:00:00.0000000', timeZone: 'UTC' },
    }, 'UTC');
    expect(event.isDeleted).toBe(true);
    expect(event.status).toBe('cancelled');
  });
});

describe('microsoftValidationToken', () => {
  it('returns the Graph validation token', () => {
    const url = new URL('https://example.supabase.co/functions/v1/microsoft-webhook?validationToken=abc123');
    expect(microsoftValidationToken(url)).toBe('abc123');
  });
});

describe('Microsoft authorize URL', () => {
  it('matches the Google-style query and omits prompt/openid extras that trigger AADSTS90013', () => {
    const provider = new MicrosoftCalendarProvider('20407466-bbfb-4193-ba10-b77e5c37d11f', 'secret', 'common');
    const url = provider.getAuthorizationUrl({
      state: 'abc',
      codeChallenge: 'challenge',
      redirectUri: 'https://example.supabase.co/functions/v1/microsoft-oauth',
    });
    expect(url).toContain('https://login.microsoftonline.com/common/oauth2/v2.0/authorize?');
    expect(url).toContain('response_type=code');
    expect(url).toContain('code_challenge_method=S256');
    expect(url).toContain('Calendars.ReadWrite');
    expect(url).toContain('offline_access');
    expect(url).toContain('User.Read');
    expect(url).not.toContain('prompt=');
    expect(url).not.toContain('openid');
    expect(url).not.toContain('response_mode=');
  });
});

describe('isDeltaLinkInvalid', () => {
  it('treats Graph 410 as a full resync', () => {
    expect(isDeltaLinkInvalid(410, 'The delta token is invalid')).toBe(true);
    expect(isDeltaLinkInvalid(200, 'ok')).toBe(false);
  });
});
