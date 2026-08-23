import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';
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
  const secret = Deno.env.get('CRON_SECRET');
  if (!secret) return false;
  const header = req.headers.get('x-cron-secret') ?? '';
  const bearer = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  return header === secret || bearer === secret;
}
