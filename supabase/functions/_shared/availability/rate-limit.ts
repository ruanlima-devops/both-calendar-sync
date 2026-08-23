import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';

export async function hitRateLimit(
  db: SupabaseClient,
  bucketKey: string,
  limit: number,
  windowSeconds: number,
): Promise<boolean> {
  const now = Date.now();
  const { data } = await db.from('api_rate_buckets').select('*').eq('bucket_key', bucketKey).maybeSingle();
  if (!data) {
    await db.from('api_rate_buckets').upsert({
      bucket_key: bucketKey,
      window_start: new Date(now).toISOString(),
      hit_count: 1,
    });
    return true;
  }
  const start = Date.parse(String(data.window_start));
  if (!Number.isFinite(start) || now - start > windowSeconds * 1000) {
    await db
      .from('api_rate_buckets')
      .update({ window_start: new Date(now).toISOString(), hit_count: 1 })
      .eq('bucket_key', bucketKey);
    return true;
  }
  const next = Number(data.hit_count) + 1;
  if (next > limit) return false;
  await db.from('api_rate_buckets').update({ hit_count: next }).eq('bucket_key', bucketKey);
  return true;
}

export function clientIp(req: Request): string {
  return (
    req.headers.get('cf-connecting-ip') ||
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    req.headers.get('x-real-ip') ||
    'unknown'
  );
}
