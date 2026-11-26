import { describe, expect, it, vi } from 'vitest';
import { isBetaEnrollmentRequired, userPassesBetaEnrollment } from './enrollment.ts';

function fakeDb(settings: Record<string, string>, rpcResult: boolean | Error) {
  return {
    from: (table: string) => {
      expect(table).toBe('billing_settings');
      return {
        select: () => ({
          eq: (_k: string, key: string) => ({
            maybeSingle: async () => ({
              data: settings[key] != null ? { value: settings[key] } : null,
              error: null,
            }),
          }),
        }),
      };
    },
    rpc: async (_name: string, _args: unknown) => {
      if (rpcResult instanceof Error) return { data: null, error: rpcResult };
      return { data: rpcResult, error: null };
    },
  } as never;
}

describe('beta enrollment gate', () => {
  it('allows everyone when flag is off', async () => {
    const db = fakeDb({ beta_enrollment_required: 'false' }, false);
    expect(await isBetaEnrollmentRequired(db)).toBe(false);
    expect(await userPassesBetaEnrollment(db, 'u1')).toBe(true);
  });

  it('requires invite when flag is on', async () => {
    const db = fakeDb({ beta_enrollment_required: 'true' }, true);
    expect(await isBetaEnrollmentRequired(db)).toBe(true);
    expect(await userPassesBetaEnrollment(db, 'u1')).toBe(true);
  });

  it('fails closed on rpc error when required', async () => {
    const db = fakeDb({ beta_enrollment_required: 'true' }, new Error('boom'));
    expect(await userPassesBetaEnrollment(db, 'u1')).toBe(false);
  });
});
