import { describe, expect, it } from 'vitest';
import {
  PROD_FRONTEND_HOST,
  PROD_SUPABASE_REF,
  PROD_TARGET_SUPABASE_ORG,
  STAGE_SUPABASE_ORG,
  prodBrandedRedirectInventory,
  prodTechnicalRedirectInventory,
  supabaseAuthCallback,
  supabaseFunctionCallback,
} from './prod-redirects';

describe('prod OAuth redirect inventory', () => {
  it('pins verified PROD ref distinct from STAGE/legacy', () => {
    expect(PROD_SUPABASE_REF).toBe('djxulqyuafhihmuyzvvk');
    expect(PROD_SUPABASE_REF).not.toBe('qszggrrjhcwltnmxpxcy');
    expect(PROD_SUPABASE_REF).not.toBe('sknpqjodttkpttaytdut');
  });

  it('pins Scenario C org ids (STAGE Free vs PROD target)', () => {
    expect(STAGE_SUPABASE_ORG).toBe('otaqdspnjsewiymnqbmr');
    expect(PROD_TARGET_SUPABASE_ORG).toBe('ufxaefwnhwzxafvajsfg');
    expect(PROD_TARGET_SUPABASE_ORG).not.toBe(STAGE_SUPABASE_ORG);
    expect(PROD_FRONTEND_HOST).toBe('https://app.bothcalendar.com');
  });

  it('builds technical Sign-In and Calendar callbacks from source function names', () => {
    const inv = prodTechnicalRedirectInventory();
    expect(inv.signInCallback).toBe(
      'https://djxulqyuafhihmuyzvvk.supabase.co/auth/v1/callback',
    );
    expect(inv.googleCalendarCallback).toBe(
      'https://djxulqyuafhihmuyzvvk.supabase.co/functions/v1/google-oauth',
    );
    expect(inv.microsoftCalendarCallback).toBe(
      'https://djxulqyuafhihmuyzvvk.supabase.co/functions/v1/microsoft-oauth',
    );
  });

  it('keeps branded inventory on auth.bothcalendar.com without inventing paths', () => {
    const inv = prodBrandedRedirectInventory();
    expect(inv.signInCallback).toBe('https://auth.bothcalendar.com/auth/v1/callback');
    expect(inv.googleCalendarCallback).toBe(
      'https://auth.bothcalendar.com/functions/v1/google-oauth',
    );
    expect(inv.microsoftCalendarCallback).toBe(
      'https://auth.bothcalendar.com/functions/v1/microsoft-oauth',
    );
  });

  it('helpers reject trailing slash duplication', () => {
    expect(supabaseAuthCallback('https://example.test/')).toBe(
      'https://example.test/auth/v1/callback',
    );
    expect(supabaseFunctionCallback('https://example.test/', 'google-oauth')).toBe(
      'https://example.test/functions/v1/google-oauth',
    );
  });
});
