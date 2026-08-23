import {
  BUSY_DESCRIPTION,
  BUSY_TITLE,
  type CreateEventInput,
  type NormalizedEvent,
} from '../sync/types.ts';

export type FirewallPrivacyPreset = 'availability' | 'limited' | 'full' | 'custom';

export interface FirewallRule {
  id: string;
  userId: string;
  sourceCalendarId: string;
  destinationCalendarId: string;
  enabled: boolean;
  privacyPreset: FirewallPrivacyPreset;
  syncTitle: boolean;
  syncDescription: boolean;
  syncLocation: boolean;
  syncAttendees: boolean;
  syncConference: boolean;
  ignoreFree: boolean;
  ignoreCancelled: boolean;
  placeholderTitle: string;
  busyStatus: 'busy' | 'tentative' | 'oof';
}

export function isEventFreeForAvailability(incoming: NormalizedEvent): boolean {
  const t = (incoming.busyTransparency ?? '').toLowerCase();
  if (t === 'transparent' || t === 'free') return true;
  if (t === 'opaque' || t === 'busy' || t === 'tentative' || t === 'oof' || t === 'workingelsewhere') {
    return false;
  }
  // Unknown → treat as busy (block by default)
  return false;
}

export function shouldPropagateEvent(rule: FirewallRule, incoming: NormalizedEvent): boolean {
  if (!rule.enabled) return false;
  if (rule.ignoreCancelled && (incoming.isDeleted || incoming.status === 'cancelled')) return false;
  if (rule.ignoreFree && isEventFreeForAvailability(incoming)) return false;
  return true;
}

/** Build provider payload for a managed mirror according to the firewall rule. */
export function mirrorPayloadFromRule(
  rule: FirewallRule,
  incoming: NormalizedEvent,
  syncGroupId: string,
): CreateEventInput {
  const availabilityOnly =
    !rule.syncTitle && !rule.syncDescription && !rule.syncLocation && !rule.syncAttendees && !rule.syncConference;

  const title = rule.syncTitle
    ? incoming.title || rule.placeholderTitle || BUSY_TITLE
    : rule.placeholderTitle || BUSY_TITLE;

  const description = rule.syncDescription
    ? incoming.description
    : availabilityOnly || !rule.syncTitle
      ? BUSY_DESCRIPTION
      : undefined;

  const location = rule.syncLocation ? incoming.location : undefined;

  return {
    title,
    description,
    location,
    startAt: incoming.startAt,
    endAt: incoming.endAt,
    timezone: incoming.timezone,
    allDay: incoming.allDay,
    role: 'MIRROR',
    syncGroupId,
    // Attendees / conference intentionally never copied (API fields not wired for invite fan-out).
  };
}

export function applyPreset(preset: FirewallPrivacyPreset): Pick<
  FirewallRule,
  'privacyPreset' | 'syncTitle' | 'syncDescription' | 'syncLocation' | 'syncAttendees' | 'syncConference'
> {
  if (preset === 'full') {
    return {
      privacyPreset: 'full',
      syncTitle: true,
      syncDescription: true,
      syncLocation: true,
      syncAttendees: false, // never auto-invite
      syncConference: false, // never create Meet/Teams on placeholder
    };
  }
  if (preset === 'limited') {
    return {
      privacyPreset: 'limited',
      syncTitle: true,
      syncDescription: false,
      syncLocation: true,
      syncAttendees: false,
      syncConference: false,
    };
  }
  return {
    privacyPreset: 'availability',
    syncTitle: false,
    syncDescription: false,
    syncLocation: false,
    syncAttendees: false,
    syncConference: false,
  };
}
