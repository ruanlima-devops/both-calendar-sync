export const BOTH_STAGE_PROJECT_REF = 'qszggrrjhcwltnmxpxcy';
export const LEGACY_STAGE_PROJECT_REF = 'sknpqjodttkpttaytdut';

export type AppVariantName = 'development' | 'preview' | 'production';

export function projectRefFromSupabaseUrl(url: string): string | null {
  try {
    const host = new URL(url).hostname.toLowerCase();
    const match = host.match(/^([a-z0-9]+)\.supabase\.co$/);
    return match?.[1] ?? null;
  } catch {
    return null;
  }
}

export function schemeForVariant(variant: string): string {
  if (variant === 'preview') return 'both-stg';
  if (variant === 'production') return 'both';
  return 'both-dev';
}

export function bundleIdForVariant(variant: string): string {
  if (variant === 'preview') return 'com.bothcalendarsync.app.staging';
  if (variant === 'production') return 'com.bothcalendarsync.app';
  return 'com.bothcalendarsync.app.dev';
}

export function generatedOAuthReturn(variant: string): string {
  return `${schemeForVariant(variant)}://oauth`;
}

export function generatedAuthCallback(variant: string): string {
  return `${schemeForVariant(variant)}://auth/callback`;
}

export function environmentWarnings(input: { variant?: string; supabaseUrl?: string }): string[] {
  const warnings: string[] = [];
  const variant = input.variant || 'development';
  const ref = input.supabaseUrl ? projectRefFromSupabaseUrl(input.supabaseUrl) : null;

  if (variant === 'preview' && ref === LEGACY_STAGE_PROJECT_REF) {
    warnings.push('APP_VARIANT=preview is pointing at LEGACY unify-dev, not Both STAGE.');
  }
  if (variant === 'production' && (ref === LEGACY_STAGE_PROJECT_REF || ref === BOTH_STAGE_PROJECT_REF)) {
    warnings.push('APP_VARIANT=production should use a dedicated PROD Supabase project.');
  }
  return warnings;
}

export function describeEnvironment(input: { variant?: string; supabaseUrl?: string }): {
  variant: string;
  supabaseHost: string;
  projectRef: string | null;
  scheme: string;
  bundleId: string;
  generatedOAuthReturn: string;
  generatedAuthCallback: string;
  warnings: string[];
} {
  const variant = input.variant || 'development';
  let host = '(unset)';
  if (input.supabaseUrl) {
    try {
      host = new URL(input.supabaseUrl).host;
    } catch {
      host = '(invalid)';
    }
  }
  return {
    variant,
    supabaseHost: host,
    projectRef: input.supabaseUrl ? projectRefFromSupabaseUrl(input.supabaseUrl) : null,
    scheme: schemeForVariant(variant),
    bundleId: bundleIdForVariant(variant),
    generatedOAuthReturn: generatedOAuthReturn(variant),
    generatedAuthCallback: generatedAuthCallback(variant),
    warnings: environmentWarnings(input),
  };
}
