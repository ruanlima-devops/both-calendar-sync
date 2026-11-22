import { describe, expect, it } from 'vitest';
import {
  canAdvanceFromConnect,
  canFinishOnboarding,
  classifyProviderConnectError,
  firstSyncCopy,
} from './journey.ts';

describe('onboarding journey', () => {
  it('blocks connect advance without calendars', () => {
    expect(canAdvanceFromConnect(0)).toBe(false);
    expect(canAdvanceFromConnect(2)).toBe(true);
  });

  it('requires enabled calendars to finish', () => {
    expect(canFinishOnboarding({ calendarCount: 0, enabledCount: 0 }).ok).toBe(false);
    expect(canFinishOnboarding({ calendarCount: 2, enabledCount: 0 }).ok).toBe(false);
    expect(canFinishOnboarding({ calendarCount: 2, enabledCount: 1 }).ok).toBe(true);
  });

  it('classifies provider permission denials', () => {
    const denied = classifyProviderConnectError(new Error('access_denied by user'));
    expect(denied.ok).toBe(false);
    if (!denied.ok) expect(denied.code).toBe('PROVIDER_DENIED');
  });

  it('exposes recoverable first-sync copy', () => {
    expect(firstSyncCopy({ status: 'failed', enabledCount: 1 }).title).toMatch(/Não concluímos/i);
    expect(firstSyncCopy({ status: 'success', enabledCount: 3 }).body).toMatch(/3 calendário/);
  });
});
