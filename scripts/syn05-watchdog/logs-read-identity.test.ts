/**
 * OF-03 logs read identity — offline validators. No live Logs API.
 */

import { describe, expect, it } from 'vitest';
import {
  DEFAULT_LOGS_READ_IDENTITY_CONFIG,
  LOGS_READ_IDENTITY_DESIGN,
  assertLogsReadReady,
  inspectLogsCredentialPresence,
  redactLogsHttpError,
  validateLogsReadIdentityConfig,
} from './logs-read-identity.ts';

describe('OF-03 config', () => {
  it('default config validates', () => {
    expect(validateLogsReadIdentityConfig(DEFAULT_LOGS_READ_IDENTITY_CONFIG).ok).toBe(true);
  });

  it('rejects fallback true', () => {
    const r = validateLogsReadIdentityConfig({
      ...DEFAULT_LOGS_READ_IDENTITY_CONFIG,
      allow_fallback: true,
    });
    expect(r.ok).toBe(false);
  });

  it('rejects github_issues isolation true', () => {
    const r = validateLogsReadIdentityConfig({
      ...DEFAULT_LOGS_READ_IDENTITY_CONFIG,
      isolation: {
        collector: true,
        evaluator: false,
        delivery: false,
        github_issues: true,
      },
    });
    expect(r.ok).toBe(false);
  });
});

describe('OF-03 credential presence', () => {
  it('absent token', () => {
    expect(inspectLogsCredentialPresence(undefined)).toEqual({
      present: false,
      code: 'token_absent',
    });
  });

  it('fake ok shape', () => {
    const r = inspectLogsCredentialPresence('fake_logs_read_unit_test_01');
    expect(r.present).toBe(true);
    if (r.present) expect(r.shape).toBe('fake_ok');
  });

  it('malformed token', () => {
    const r = inspectLogsCredentialPresence('not-a-token');
    expect(r.present).toBe(true);
    if (r.present) expect(r.shape).toBe('malformed');
  });

  it('revoked marker', () => {
    const r = inspectLogsCredentialPresence('REVOKED_PLACEHOLDER');
    expect(r.present).toBe(true);
    if (r.present) expect(r.shape).toBe('looks_revoked_marker');
  });

  it('assertLogsReadReady fail-closed for absent', () => {
    const r = assertLogsReadReady({
      config: DEFAULT_LOGS_READ_IDENTITY_CONFIG,
      token: null,
    });
    expect(r).toEqual({ ok: false, code: 'token_absent' });
  });

  it('assertLogsReadReady never authorizes live in OF E2E even for fake_ok', () => {
    const r = assertLogsReadReady({
      config: DEFAULT_LOGS_READ_IDENTITY_CONFIG,
      token: 'fake_logs_read_unit_test_01',
    });
    expect(r).toEqual({ ok: false, code: 'live_logs_read_not_authorized_in_of_e2e' });
  });
});

describe('OF-03 redaction / design', () => {
  it('redacts http error bodies with tokens', () => {
    const msg = redactLogsHttpError(401, 'Authorization: Bearer ghp_abcdefghijklmnopqrstuvwxyz');
    expect(msg).toContain('[redacted]');
    expect(msg).not.toContain('ghp_');
  });

  it('design records granularity gap and not provisioned', () => {
    expect(LOGS_READ_IDENTITY_DESIGN.provisioned).toBe(false);
    expect(LOGS_READ_IDENTITY_DESIGN.live_reads_authorized).toBe(false);
    expect(LOGS_READ_IDENTITY_DESIGN.least_privilege_confirmed).toBe(false);
    expect(LOGS_READ_IDENTITY_DESIGN.separate_from_github_issues_token).toBe(true);
  });
});
