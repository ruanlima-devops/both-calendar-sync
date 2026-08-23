import { describe, expect, it } from 'vitest';
import {
  applyPreset,
  isEventFreeForAvailability,
  mirrorPayloadFromRule,
  shouldPropagateEvent,
  type FirewallRule,
} from './rules.ts';
import type { NormalizedEvent } from '../sync/types.ts';

function rule(over: Partial<FirewallRule> = {}): FirewallRule {
  return {
    id: 'r1',
    userId: 'u1',
    sourceCalendarId: 'src',
    destinationCalendarId: 'dst',
    enabled: true,
    privacyPreset: 'availability',
    syncTitle: false,
    syncDescription: false,
    syncLocation: false,
    syncAttendees: false,
    syncConference: false,
    ignoreFree: true,
    ignoreCancelled: true,
    placeholderTitle: 'Horário reservado · Unify',
    busyStatus: 'busy',
    ...over,
  };
}

function event(over: Partial<NormalizedEvent> = {}): NormalizedEvent {
  return {
    providerEventId: 'e1',
    title: 'Consulta médica',
    description: 'Dr. X',
    location: 'Sala 2',
    startAt: '2026-08-25T17:00:00.000Z',
    endAt: '2026-08-25T18:00:00.000Z',
    timezone: 'America/Sao_Paulo',
    allDay: false,
    status: 'confirmed',
    ...over,
  };
}

describe('Calendar Firewall privacy', () => {
  it('availability preset hides all origin details', () => {
    const payload = mirrorPayloadFromRule(rule(), event(), 'sg1');
    expect(payload.title).toBe('Horário reservado · Unify');
    expect(payload.description).toContain('Unify');
    expect(payload.location).toBeUndefined();
    expect(payload.role).toBe('MIRROR');
  });

  it('limited preset shares title and location only', () => {
    const limited = rule({ ...applyPreset('limited') });
    const payload = mirrorPayloadFromRule(limited, event(), 'sg1');
    expect(payload.title).toBe('Consulta médica');
    expect(payload.location).toBe('Sala 2');
    expect(payload.description).toBeUndefined();
  });

  it('skips free events when ignore_free is on', () => {
    expect(shouldPropagateEvent(rule(), event({ busyTransparency: 'transparent' }))).toBe(false);
    expect(shouldPropagateEvent(rule(), event({ busyTransparency: 'opaque' }))).toBe(true);
  });

  it('detects free transparency', () => {
    expect(isEventFreeForAvailability(event({ busyTransparency: 'free' }))).toBe(true);
    expect(isEventFreeForAvailability(event({ busyTransparency: 'busy' }))).toBe(false);
  });
});
