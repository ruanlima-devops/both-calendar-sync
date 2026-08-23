export const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
  'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
};

export function json(body: unknown, status = 200, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json', ...extra },
  });
}

export function text(body: string, status = 200, contentType = 'text/plain'): Response {
  return new Response(body, {
    status,
    headers: { ...corsHeaders, 'Content-Type': contentType },
  });
}

export function optionsResponse(): Response {
  return new Response('ok', { headers: corsHeaders });
}

const ENV_ALIASES: Record<string, string[]> = {
  TOKEN_ENCRYPTION_KEY: ['TOKEN_ENCRYPTION_KEY'],
  SUPABASE_SERVICE_ROLE_KEY: ['SUPABASE_SERVICE_ROLE_KEY'],
  CRON_SECRET: ['CRON_SECRET'],
  GOOGLE_WEBHOOK_URL: ['GOOGLE_WEBHOOK_URL'],
  MICROSOFT_WEBHOOK_URL: ['MICROSOFT_WEBHOOK_URL'],
  MICROSOFT_TENANT: ['MICROSOFT_TENANT_ID'],
  STRIPE_SECRET_KEY: ['STRIPE_SECRET_KEY'],
  STRIPE_WEBHOOK_SECRET: ['STRIPE_WEBHOOK_SECRET'],
  STRIPE_PRICE_ID: ['STRIPE_PRICE_ID'],
};

export function env(name: string): string {
  const value = envOptional(name);
  if (!value) throw new Error(`Missing env ${name}`);
  return value;
}

export function isUsableHttpUrl(value: string): boolean {
  if (!value || value.includes('<') || value.includes('>') || /YOUR_PROJECT/i.test(value)) {
    return false;
  }
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:';
  } catch {
    return false;
  }
}

export function functionPublicUrl(functionName: string, explicit?: string): string {
  const configured = explicit?.trim();
  if (configured && isUsableHttpUrl(configured)) return configured.replace(/\/$/, '');
  const base = (envOptional('SUPABASE_URL') ?? '').replace(/\/$/, '');
  if (!isUsableHttpUrl(base)) {
    throw new Error(`Missing public URL for ${functionName}`);
  }
  return `${base}/functions/v1/${functionName}`;
}

export function envOptional(name: string): string | undefined {
  const keys = [name, ...(ENV_ALIASES[name] ?? [])];
  for (const [canonical, aliases] of Object.entries(ENV_ALIASES)) {
    if (aliases.includes(name) && !keys.includes(canonical)) keys.push(canonical);
  }
  for (const key of keys) {
    const value = Deno.env.get(key);
    if (value) return value;
  }
  return undefined;
}

export function logSafe(message: string, extra?: Record<string, unknown>): void {
  const scrubbed = extra
    ? Object.fromEntries(
        Object.entries(extra).map(([k, v]) => {
          const key = k.toLowerCase();
          if (key.includes('token') || key.includes('secret') || key.includes('authorization')) {
            return [k, '[redacted]'];
          }
          return [k, v];
        }),
      )
    : undefined;
  console.log(JSON.stringify({ message, ...scrubbed }));
}
