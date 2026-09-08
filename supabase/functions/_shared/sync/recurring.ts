import { logSafe } from '../http.ts';
import type { NormalizedEvent, ProviderName } from './types.ts';

/** Both 1.0 recurring classification — used only for safety boundaries. */
export type RecurringKind = 'single' | 'series_master' | 'occurrence' | 'exception';

export function classifyRecurringKind(input: {
  recurrenceRule?: string | null;
  recurringEventId?: string | null;
  providerEventType?: string | null;
  recurringKind?: RecurringKind | null;
}): RecurringKind {
  if (input.recurringKind) return input.recurringKind;
  const t = String(input.providerEventType ?? '').toLowerCase();
  if (t === 'seriesmaster') return 'series_master';
  if (t === 'exception') return 'exception';
  if (t === 'occurrence') return 'occurrence';
  if (t === 'singleinstance') return 'single';
  // Google instances/exceptions both carry recurringEventId under singleEvents expansion.
  if (input.recurringEventId) return 'occurrence';
  if (input.recurrenceRule) return 'series_master';
  return 'single';
}

export function attachRecurringKind<T extends NormalizedEvent>(event: T): T & { recurringKind: RecurringKind } {
  const recurringKind = classifyRecurringKind(event);
  return { ...event, recurringKind };
}

/**
 * CreateEventInput has no RRULE — mirroring a series master would create a single
 * non-recurring busy block and corrupt expectations. Skip mirror create for masters.
 * Occurrences/exceptions may still get per-slot busy mirrors.
 */
export function canMirrorRecurringKind(kind: RecurringKind): boolean {
  return kind !== 'series_master';
}

export function logRecurringSkipped(input: {
  provider: ProviderName | string;
  operation: string;
  eventKind: RecurringKind;
  reason: string;
}): void {
  logSafe('recurring_operation_skipped', {
    provider: input.provider,
    operation: input.operation,
    event_kind: input.eventKind,
    reason: input.reason,
  });
}

/** API / actor mutations that Both 1.0 does not support safely. */
export function isUnsupportedRecurringMutation(kind: RecurringKind): boolean {
  return kind === 'series_master' || kind === 'occurrence' || kind === 'exception';
}

export const UNSUPPORTED_RECURRING_OPERATION = 'UNSUPPORTED_RECURRING_OPERATION';
