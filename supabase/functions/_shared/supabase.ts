import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { cronSecretMatches } from './auth-guards.ts';
import { env } from './http.ts';

export function adminClient(): SupabaseClient {
  return createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export async function userFromRequest(req: Request): Promise<{ userId: string; token: string }> {
  const auth = req.headers.get('Authorization') ?? '';
  const token = auth.replace(/^Bearer\s+/i, '').trim();
  if (!token) throw new Error('UNAUTHENTICATED');
  const supabase = adminClient();
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user) throw new Error('UNAUTHENTICATED');
  return { userId: data.user.id, token };
}

export function cronAuthorized(req: Request): boolean {
  return cronSecretMatches(req, Deno.env.get('CRON_SECRET'));
}
