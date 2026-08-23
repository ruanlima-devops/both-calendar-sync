/** IANA timezones for profile picker (sorted). */
export function listTimezones(): string[] {
  try {
    const values = Intl.supportedValuesOf('timeZone');
    return [...values].sort((a, b) => a.localeCompare(b));
  } catch {
    return FALLBACK_TIMEZONES;
  }
}

const FALLBACK_TIMEZONES = [
  'America/Sao_Paulo',
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'Europe/London',
  'Europe/Paris',
  'Europe/Berlin',
  'Asia/Tokyo',
  'UTC',
];

export function timezoneLabel(tz: string): string {
  try {
    const parts = new Intl.DateTimeFormat('pt-BR', {
      timeZone: tz,
      timeZoneName: 'shortOffset',
    }).formatToParts(new Date());
    const offset = parts.find((p) => p.type === 'timeZoneName')?.value ?? '';
    return offset ? `${tz} (${offset})` : tz;
  } catch {
    return tz;
  }
}
