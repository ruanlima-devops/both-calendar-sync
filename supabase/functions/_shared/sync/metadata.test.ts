import { describe, expect, it } from 'vitest';
import { parseGoogleEvent, toGoogleBody } from '../providers/google.ts';
import { parseMicrosoftEvent, toMicrosoftBody } from '../providers/microsoft.ts';
import { MS_PROP_GUID, UNIFY_PROP_GROUP, UNIFY_PROP_ROLE } from './types.ts';
import {
  buildUnifyPrivateProps,
  normalizeOptionalUuid,
  optionalUuidOrNull,
  optionalUuidOrUndefined,
} from './metadata.ts';
import { applyIncomingEvent } from './engine.ts';
import { MemoryStore, RecordingActor } from './memory-store.ts';
import type { NormalizedEvent, SyncContext } from './types.ts';

const VALID = 'f1940169-1111-4111-8111-000000000001';

describe('normalizeOptionalUuid', () => {
  it('treats undefined/null/empty/whitespace as absent', () => {
    expect(normalizeOptionalUuid(undefined)).toEqual({ kind: 'absent' });
    expect(normalizeOptionalUuid(null)).toEqual({ kind: 'absent' });
    expect(normalizeOptionalUuid('')).toEqual({ kind: 'absent' });
    expect(normalizeOptionalUuid('   ')).toEqual({ kind: 'absent' });
  });

  it('preserves a valid UUID', () => {
    expect(normalizeOptionalUuid(VALID)).toEqual({ kind: 'valid', value: VALID });
    expect(normalizeOptionalUuid(`  ${VALID}  `)).toEqual({ kind: 'valid', value: VALID });
  });

  it('marks non-empty non-UUID as invalid (not silently absent)', () => {
    expect(normalizeOptionalUuid('not-a-uuid')).toEqual({ kind: 'invalid', value: 'not-a-uuid' });
  });

  it('optional helpers omit absent and invalid', () => {
    expect(optionalUuidOrUndefined('')).toBeUndefined();
    expect(optionalUuidOrUndefined('not-a-uuid')).toBeUndefined();
    expect(optionalUuidOrUndefined(VALID)).toBe(VALID);
    expect(optionalUuidOrNull('')).toBeNull();
    expect(optionalUuidOrNull('not-a-uuid')).toBeNull();
    expect(optionalUuidOrNull(VALID)).toBe(VALID);
  });
});

describe('producer: empty sync group metadata', () => {
  it('omits unifySyncGroupId when empty (Google)', () => {
    const props = buildUnifyPrivateProps({ syncGroupId: '', role: 'EXTERNAL' });
    expect(props).toEqual({ [UNIFY_PROP_ROLE]: 'EXTERNAL' });
    expect(props).not.toHaveProperty(UNIFY_PROP_GROUP);

    const body = toGoogleBody({
      title: 't',
      startAt: '2026-09-15T00:00:00.000Z',
      endAt: '2026-09-16T00:00:00.000Z',
      allDay: true,
      timezone: 'UTC',
      role: 'EXTERNAL',
      syncGroupId: '',
    });
    const privateProps = (body.extendedProperties as { private: Record<string, string> }).private;
    expect(privateProps).not.toHaveProperty(UNIFY_PROP_GROUP);
    expect(privateProps[UNIFY_PROP_ROLE]).toBe('EXTERNAL');
  });

  it('includes unifySyncGroupId when valid UUID (Google)', () => {
    const props = buildUnifyPrivateProps({ syncGroupId: VALID, role: 'MIRROR' });
    expect(props[UNIFY_PROP_GROUP]).toBe(VALID);

    const body = toGoogleBody({
      title: 't',
      startAt: '2026-09-15T12:00:00.000Z',
      endAt: '2026-09-15T13:00:00.000Z',
      allDay: false,
      timezone: 'UTC',
      role: 'MIRROR',
      syncGroupId: VALID,
    });
    const privateProps = (body.extendedProperties as { private: Record<string, string> }).private;
    expect(privateProps[UNIFY_PROP_GROUP]).toBe(VALID);
  });

  it('omits empty group on Microsoft and includes valid UUID', () => {
    const empty = toMicrosoftBody({
      title: 't',
      startAt: '2026-09-15T00:00:00.000Z',
      endAt: '2026-09-16T00:00:00.000Z',
      allDay: true,
      timezone: 'UTC',
      role: 'EXTERNAL',
      syncGroupId: '',
    });
    const emptyProps = empty.singleValueExtendedProperties as Array<{ id: string; value: string }>;
    expect(emptyProps.some((p) => p.id.includes(UNIFY_PROP_GROUP))).toBe(false);

    const withGroup = toMicrosoftBody({
      title: 't',
      startAt: '2026-09-15T12:00:00.000Z',
      endAt: '2026-09-15T13:00:00.000Z',
      allDay: false,
      timezone: 'UTC',
      role: 'MIRROR',
      syncGroupId: VALID,
    });
    const props = withGroup.singleValueExtendedProperties as Array<{ id: string; value: string }>;
    const groupProp = props.find((p) => p.id.includes(UNIFY_PROP_GROUP));
    expect(groupProp?.value).toBe(VALID);
  });
});

describe('consumer: empty sync group metadata', () => {
  it('Google parser treats empty unifySyncGroupId as missing', () => {
    const event = parseGoogleEvent(
      {
        id: 'e1',
        summary: 'x',
        start: { date: '2026-09-15' },
        end: { date: '2026-09-16' },
        extendedProperties: { private: { [UNIFY_PROP_GROUP]: '', [UNIFY_PROP_ROLE]: 'EXTERNAL' } },
      },
      'UTC',
    );
    expect(event.unifySyncGroupId).toBeUndefined();
  });

  it('Google parser preserves valid UUID', () => {
    const event = parseGoogleEvent(
      {
        id: 'e1',
        summary: 'x',
        start: { dateTime: '2026-09-15T12:00:00Z' },
        end: { dateTime: '2026-09-15T13:00:00Z' },
        extendedProperties: { private: { [UNIFY_PROP_GROUP]: VALID } },
      },
      'UTC',
    );
    expect(event.unifySyncGroupId).toBe(VALID);
  });

  it('Microsoft parser treats empty group as missing and keeps valid UUID', () => {
    const groupId = `String {${MS_PROP_GUID}} Name ${UNIFY_PROP_GROUP}`;
    const empty = parseMicrosoftEvent(
      {
        id: 'm1',
        subject: 'x',
        isAllDay: true,
        start: { dateTime: '2026-09-15T00:00:00', timeZone: 'UTC' },
        end: { dateTime: '2026-09-16T00:00:00', timeZone: 'UTC' },
        singleValueExtendedProperties: [{ id: groupId, value: '' }],
      },
      'UTC',
    );
    expect(empty.unifySyncGroupId).toBeUndefined();

    const valid = parseMicrosoftEvent(
      {
        id: 'm2',
        subject: 'x',
        start: { dateTime: '2026-09-15T12:00:00', timeZone: 'UTC' },
        end: { dateTime: '2026-09-15T13:00:00', timeZone: 'UTC' },
        singleValueExtendedProperties: [{ id: groupId, value: VALID }],
      },
      'UTC',
    );
    expect(valid.unifySyncGroupId).toBe(VALID);
  });
});

describe('regression M1-F-01: unifySyncGroupId=""', () => {
  it('does not persist empty string as syncGroupId (no uuid parse path)', async () => {
    const store = new MemoryStore();
    store.registerCalendar('cal-g', 'conn-g', 'google-primary');
    const actor = new RecordingActor();
    const context: SyncContext = {
      userId: 'user-1',
      connectionId: 'conn-g',
      connectedCalendarId: 'cal-g',
      provider: 'GOOGLE',
      autoBlockOthers: false,
      targets: [],
      firewallRules: [],
    };
    const incoming: NormalizedEvent = {
      providerEventId: 'poison-empty-group',
      title: 'BOTH-E2E-EMPTY-GROUP',
      startAt: '2026-09-15T00:00:00.000Z',
      endAt: '2026-09-16T00:00:00.000Z',
      timezone: 'UTC',
      allDay: true,
      status: 'confirmed',
      unifySyncGroupId: '',
    };

    const result = await applyIncomingEvent(context, incoming, store, actor);
    expect(result.errors).toEqual([]);
    expect(result.stored?.syncGroupId).toBeNull();
    // Memory store would accept ""; engine must normalize before upsert.
    expect(result.stored?.syncGroupId).not.toBe('');
  });

  it('skips invalid non-empty group metadata without treating it as UUID', async () => {
    const store = new MemoryStore();
    store.registerCalendar('cal-g', 'conn-g', 'google-primary');
    const actor = new RecordingActor();
    const context: SyncContext = {
      userId: 'user-1',
      connectionId: 'conn-g',
      connectedCalendarId: 'cal-g',
      provider: 'GOOGLE',
      autoBlockOthers: false,
      targets: [],
      firewallRules: [],
    };
    const incoming: NormalizedEvent = {
      providerEventId: 'bad-group',
      title: 'bad',
      startAt: '2026-09-15T12:00:00.000Z',
      endAt: '2026-09-15T13:00:00.000Z',
      timezone: 'UTC',
      allDay: false,
      status: 'confirmed',
      unifySyncGroupId: 'not-a-uuid',
    };
    const result = await applyIncomingEvent(context, incoming, store, actor);
    expect(result.errors).toEqual([]);
    expect(result.stored?.syncGroupId).toBeNull();
  });
});
