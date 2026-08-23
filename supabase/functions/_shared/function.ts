import { json, optionsResponse, text } from './http.ts';
import { adminClient, cronAuthorized, userFromRequest } from './supabase.ts';

export { adminClient, cronAuthorized, json, optionsResponse, text, userFromRequest };

export async function handle(req: Request, fn: (req: Request) => Promise<Response>): Promise<Response> {
  if (req.method === 'OPTIONS') return optionsResponse();
  try {
    return await fn(req);
  } catch (err) {
    const message = String(err);
    const status = message.includes('UNAUTHENTICATED') ? 401 : 400;
    return json({ error: message }, status);
  }
}
