/**
 * Onboarding calendar-step helpers (pure) — STG-06.
 */

export type OnboardingCalendarFlags = {
  id: string;
  enabled: boolean;
  auto_block_others: boolean;
};

/** Toggle visibility for a calendar row (preserves other fields). */
export function toggleCalendarEnabled<T extends OnboardingCalendarFlags>(
  rows: T[],
  calendarId: string,
): T[] {
  return rows.map((row) =>
    row.id === calendarId ? { ...row, enabled: !row.enabled } : row,
  );
}

export function toggleAutoBlockOthers<T extends OnboardingCalendarFlags>(
  rows: T[],
  calendarId: string,
): T[] {
  return rows.map((row) =>
    row.id === calendarId ? { ...row, auto_block_others: !row.auto_block_others } : row,
  );
}

export function enabledCalendarCount(rows: Array<{ enabled: boolean }>): number {
  return rows.filter((row) => row.enabled).length;
}
