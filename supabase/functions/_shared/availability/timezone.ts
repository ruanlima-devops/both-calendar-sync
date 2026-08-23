/** Timezone helpers for Availability Engine (Deno / Edge). */

export function zonedParts(
  ms: number,
  timeZone: string,
): { y: number; mo: number; d: number; weekday: number; dayKey: string } {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  const parts = Object.fromEntries(fmt.formatToParts(new Date(ms)).map((p) => [p.type, p.value]));
  const weekdayMap: Record<string, number> = {
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
    Sun: 7,
  };
  const y = Number(parts.year);
  const mo = Number(parts.month);
  const d = Number(parts.day);
  return {
    y,
    mo,
    d,
    weekday: weekdayMap[parts.weekday ?? 'Mon'] ?? 1,
    dayKey: `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`,
  };
}

/** Convert local wall time in `timeZone` to UTC epoch ms. */
export function localToUtcMs(
  y: number,
  mo: number,
  d: number,
  h: number,
  m: number,
  timeZone: string,
): number {
  const guess = Date.UTC(y, mo - 1, d, h, m, 0, 0);
  const parts = zonedParts(guess, timeZone);
  // Adjust if timezone offset skewed the calendar day/hour
  const asLocal = Date.UTC(parts.y, parts.mo - 1, parts.d, Number(
    new Intl.DateTimeFormat('en-US', {
      timeZone,
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(new Date(guess))
      .find((p) => p.type === 'hour')?.value ?? h,
  ), Number(
    new Intl.DateTimeFormat('en-US', {
      timeZone,
      minute: '2-digit',
    })
      .formatToParts(new Date(guess))
      .find((p) => p.type === 'minute')?.value ?? m,
  ));
  const desired = Date.UTC(y, mo - 1, d, h, m, 0, 0);
  // Binary-search style: use Temporal-like approach via offset
  const probe = new Date(`${String(y).padStart(4, '0')}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00`);
  // Fallback: format offset
  const utcGuess = Date.UTC(y, mo - 1, d, h, m, 0, 0);
  for (const delta of [0, -12, 12, -14, 14].flatMap((hours) =>
    Array.from({ length: 4 }, (_, i) => (hours * 60 + (i - 1) * 30) * 60_000),
  )) {
    const candidate = utcGuess + delta;
    const p = zonedParts(candidate, timeZone);
    const hm = new Intl.DateTimeFormat('en-GB', {
      timeZone,
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).format(new Date(candidate));
    const [hh, mm] = hm.split(':').map(Number);
    if (p.y === y && p.mo === mo && p.d === d && hh === h && mm === m) return candidate;
  }
  void asLocal;
  void desired;
  void probe;
  return utcGuess;
}

export const RESERVED_USERNAMES = new Set([
  'book',
  'auth',
  'oauth',
  'api',
  'admin',
  'settings',
  'login',
  'signup',
  'privacy',
  'terms',
  'billing',
  'paywall',
  'availability',
  'scheduling',
  'app',
  'www',
  'unify',
  'delete-account',
]);

export function isValidUsername(value: string): boolean {
  return /^[a-z0-9]([a-z0-9-]{1,30}[a-z0-9])?$/.test(value) && !RESERVED_USERNAMES.has(value);
}

export function isValidLinkSlug(value: string): boolean {
  return /^[a-z0-9]([a-z0-9-]{0,46}[a-z0-9])?$/.test(value) && !RESERVED_USERNAMES.has(value);
}
