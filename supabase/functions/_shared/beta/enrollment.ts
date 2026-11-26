import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';

/**
 * Server-side closed-beta gate.
 * When billing_settings.beta_enrollment_required=true, user must have a valid invite.
 * Default is OFF (false) — safe for STAGE internal QA.
 */
export async function isBetaEnrollmentRequired(db: SupabaseClient): Promise<boolean> {
  const { data } = await db
    .from('billing_settings')
    .select('value')
    .eq('key', 'beta_enrollment_required')
    .maybeSingle();
  return String(data?.value ?? 'false') === 'true';
}

export async function userPassesBetaEnrollment(
  db: SupabaseClient,
  userId: string,
): Promise<boolean> {
  const required = await isBetaEnrollmentRequired(db);
  if (!required) return true;
  const { data, error } = await db.rpc('user_has_beta_enrollment', {
    p_user_id: userId,
  });
  if (error) {
    // Fail closed when enrollment is required and the check cannot run.
    return false;
  }
  return data === true;
}
