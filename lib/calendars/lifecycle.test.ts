import { describe, expect, it } from 'vitest';
import {
  buildConnectionCardView,
  isolateProviderConnections,
  prepareDisconnect,
} from './lifecycle.ts';

describe('STG-06B calendar lifecycle helpers', () => {
  it('maps connection statuses for UI smoke', () => {
    expect(buildConnectionCardView({
      provider: 'GOOGLE',
      status: 'CONNECTED',
      enabledCalendarCount: 2,
    })).toMatchObject({
      statusLabel: 'Conectado',
      showReconnect: false,
      showDisconnect: true,
      enabledCalendarCount: 2,
    });
    expect(buildConnectionCardView({
      provider: 'MICROSOFT',
      status: 'AUTH_REQUIRED',
      enabledCalendarCount: 0,
    })).toMatchObject({
      statusLabel: 'Reconectar',
      showReconnect: true,
      statusTone: 'action',
    });
  });

  it('isolates providers for future disconnect/reconnect runs', () => {
    const rows = [
      { id: '1', provider: 'GOOGLE' as const },
      { id: '2', provider: 'MICROSOFT' as const },
      { id: '3', provider: 'GOOGLE' as const },
    ];
    expect(isolateProviderConnections(rows, 'GOOGLE').map((r) => r.id)).toEqual(['1', '3']);
    expect(isolateProviderConnections(rows, 'MICROSOFT')).toHaveLength(1);
  });

  it('refuses real disconnect without explicit opt-in (protects QA)', () => {
    const prep = prepareDisconnect({
      connectionId: 'c1',
      provider: 'GOOGLE',
      ownerUserId: 'u-qa',
      sessionUserId: 'u-qa',
      env: {},
    });
    expect(prep.allowed).toBe(false);
    expect(prep.code).toBe('MISSING_OPT_IN');
  });

  it('refuses disconnect for another user', () => {
    const prep = prepareDisconnect({
      connectionId: 'c1',
      provider: 'MICROSOFT',
      ownerUserId: 'u-a',
      sessionUserId: 'u-b',
      env: { BOTH_TEST_ALLOW_DISCONNECT: '1' },
    });
    expect(prep).toMatchObject({ allowed: false, code: 'WRONG_USER' });
  });

  it('allows disconnect prep only with opt-in + matching user', () => {
    const prep = prepareDisconnect({
      connectionId: 'c-ms',
      provider: 'MICROSOFT',
      ownerUserId: 'u-qa',
      sessionUserId: 'u-qa',
      env: { BOTH_TEST_ALLOW_DISCONNECT: '1' },
    });
    expect(prep).toMatchObject({
      allowed: true,
      code: 'OK',
      provider: 'MICROSOFT',
      connectionId: 'c-ms',
    });
  });
});
