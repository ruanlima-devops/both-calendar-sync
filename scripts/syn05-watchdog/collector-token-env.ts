/**
 * Prefer the dedicated Logs Read secret name (OF-03).
 * Legacy SUPABASE_ACCESS_TOKEN is accepted only as a temporary alias so
 * accidental reuse of the deploy CLI token remains visible in telemetry.
 * Never create or read real secrets here — offline policy helper only.
 */

export type CollectorTokenSource =
  | 'SUPABASE_LOGS_READ_TOKEN'
  | 'SUPABASE_ACCESS_TOKEN_LEGACY_ALIAS'
  | 'absent';

export type ResolvedCollectorToken = {
  token: string;
  source: CollectorTokenSource;
  /** True when the deploy-era alias was used — residual isolation risk. */
  usesLegacyDeployAlias: boolean;
};

export function resolveCollectorLogsReadToken(
  env: Record<string, string | undefined> = process.env,
): ResolvedCollectorToken {
  const dedicated = (env.SUPABASE_LOGS_READ_TOKEN ?? '').trim();
  if (dedicated) {
    return {
      token: dedicated,
      source: 'SUPABASE_LOGS_READ_TOKEN',
      usesLegacyDeployAlias: false,
    };
  }
  const legacy = (env.SUPABASE_ACCESS_TOKEN ?? '').trim();
  if (legacy) {
    return {
      token: legacy,
      source: 'SUPABASE_ACCESS_TOKEN_LEGACY_ALIAS',
      usesLegacyDeployAlias: true,
    };
  }
  return { token: '', source: 'absent', usesLegacyDeployAlias: false };
}
