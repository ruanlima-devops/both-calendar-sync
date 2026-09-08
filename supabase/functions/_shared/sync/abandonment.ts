/**
 * Mirror abandonment identity.
 *
 * Product rule: if the user deletes a Both-managed MIRROR on the destination
 * provider, we mark it abandoned and must NOT recreate it when the ORIGIN
 * later changes. Temporary missing observations (stale webhook/delta) must
 * NOT be treated as abandonment — only explicit abandoned status / audit log.
 */

export type MirrorAbandonmentKey = {
  originCalendarId: string;
  originProviderEventId: string;
  targetCalendarId: string;
};

/** Stable key: originCal:originProviderEventId:targetCal (provider ids may contain ':'). */
export function buildMirrorAbandonmentKey(
  originCalendarId: string,
  originProviderEventId: string,
  targetCalendarId: string,
): string {
  return `${originCalendarId}:${originProviderEventId}:${targetCalendarId}`;
}

export function parseMirrorAbandonmentKey(originKey: string): MirrorAbandonmentKey | null {
  const first = originKey.indexOf(':');
  const last = originKey.lastIndexOf(':');
  if (first <= 0 || last <= first || last >= originKey.length - 1) return null;
  const originCalendarId = originKey.slice(0, first);
  const originProviderEventId = originKey.slice(first + 1, last);
  const targetCalendarId = originKey.slice(last + 1);
  if (!originCalendarId || !originProviderEventId || !targetCalendarId) return null;
  return { originCalendarId, originProviderEventId, targetCalendarId };
}

/** Provider resource is gone (user deleted mirror externally, or already purged). */
export function isProviderGoneError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const status = (err as { httpStatus?: unknown }).httpStatus;
  return status === 404 || status === 410;
}
