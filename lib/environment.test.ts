import { describe, expect, it } from 'vitest';
import {
  BOTH_STAGE_PROJECT_REF,
  LEGACY_STAGE_PROJECT_REF,
  describeEnvironment,
  environmentWarnings,
  generatedAuthCallback,
  generatedOAuthReturn,
  projectRefFromSupabaseUrl,
} from './environment';

describe('environment mapping', () => {
  it('maps variants to generated callbacks without unify', () => {
    expect(generatedOAuthReturn('development')).toBe('both-dev://oauth');
    expect(generatedOAuthReturn('preview')).toBe('both-stg://oauth');
    expect(generatedOAuthReturn('production')).toBe('both://oauth');
    expect(generatedAuthCallback('preview')).toBe('both-stg://auth/callback');
    expect(generatedOAuthReturn('preview')).not.toContain('unify');
  });

  it('infers project ref from supabase URL', () => {
    expect(projectRefFromSupabaseUrl(`https://${BOTH_STAGE_PROJECT_REF}.supabase.co`)).toBe(
      BOTH_STAGE_PROJECT_REF,
    );
  });

  it('warns when preview points at legacy', () => {
    const warnings = environmentWarnings({
      variant: 'preview',
      supabaseUrl: `https://${LEGACY_STAGE_PROJECT_REF}.supabase.co`,
    });
    expect(warnings.some((w) => w.includes('LEGACY'))).toBe(true);
  });

  it('describes preview without keys', () => {
    const snapshot = describeEnvironment({
      variant: 'preview',
      supabaseUrl: `https://${BOTH_STAGE_PROJECT_REF}.supabase.co`,
    });
    expect(snapshot.scheme).toBe('both-stg');
    expect(snapshot.bundleId).toBe('com.bothcalendarsync.app.staging');
    expect(snapshot.projectRef).toBe(BOTH_STAGE_PROJECT_REF);
    expect(JSON.stringify(snapshot)).not.toMatch(/eyJ|service_role|secret/i);
  });
});
