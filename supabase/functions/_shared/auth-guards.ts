import { timingSafeEqual } from './crypto/tokens.ts';

export function authorizationBearerMatches(header: string | null, secret: string | undefined): boolean {
  if (!secret) return false;
  const token = (header ?? '').replace(/^Bearer\s+/i, '').trim();
  return token.length > 0 && timingSafeEqual(token, secret);
}

export function cronSecretMatches(req: Request, secret: string | undefined): boolean {
  if (!secret) return false;
  const header = req.headers.get('x-cron-secret') ?? '';
  const bearer = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  return timingSafeEqual(header, secret) || timingSafeEqual(bearer, secret);
}
