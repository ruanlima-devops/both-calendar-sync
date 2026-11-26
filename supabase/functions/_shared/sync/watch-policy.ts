import type { ProviderName } from './types.ts';

export const WATCH_RENEW_HORIZON_MS = 48 * 60 * 60 * 1000;
/** Google confirms a new channel with a `sync` notification within seconds. */
export const GOOGLE_WATCH_CONFIRM_GRACE_MS = 15 * 60 * 1000;

/**
 * An active watch/subscription is kept when it is not about to expire and is either confirmed by a
 * notification or still inside the confirmation grace window. Recreating an unconfirmed but fresh
 * Google channel is what produced back-to-back duplicate watches on connect.
 */
export function shouldKeepActiveWatch(input: {
  provider: ProviderName;
  expiresAt: string;
  createdAt?: string | null;
  lastNotificationAt?: string | null;
  now?: number;
}): boolean {
  const now = input.now ?? Date.now();
  if (new Date(input.expiresAt).getTime() <= now + WATCH_RENEW_HORIZON_MS) return false;
  if (input.provider !== 'GOOGLE' || input.lastNotificationAt) return true;
  const createdAt = input.createdAt ? new Date(input.createdAt).getTime() : Number.NaN;
  return Number.isFinite(createdAt) && now - createdAt < GOOGLE_WATCH_CONFIRM_GRACE_MS;
}
