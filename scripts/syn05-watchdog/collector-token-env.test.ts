import { describe, expect, it } from 'vitest';
import { resolveCollectorLogsReadToken } from './collector-token-env.ts';

describe('resolveCollectorLogsReadToken', () => {
  it('prefers SUPABASE_LOGS_READ_TOKEN over deploy alias', () => {
    const resolved = resolveCollectorLogsReadToken({
      SUPABASE_LOGS_READ_TOKEN: 'logs-read',
      SUPABASE_ACCESS_TOKEN: 'deploy-cli',
    });
    expect(resolved).toEqual({
      token: 'logs-read',
      source: 'SUPABASE_LOGS_READ_TOKEN',
      usesLegacyDeployAlias: false,
    });
  });

  it('falls back to legacy alias with residual-risk flag', () => {
    const resolved = resolveCollectorLogsReadToken({
      SUPABASE_ACCESS_TOKEN: 'deploy-cli',
    });
    expect(resolved.source).toBe('SUPABASE_ACCESS_TOKEN_LEGACY_ALIAS');
    expect(resolved.usesLegacyDeployAlias).toBe(true);
  });

  it('reports absent when neither is set', () => {
    expect(resolveCollectorLogsReadToken({}).source).toBe('absent');
  });
});
