import { describe, expect, it } from 'vitest';
import {
  enabledCalendarCount,
  toggleAutoBlockOthers,
  toggleCalendarEnabled,
} from './calendar-step.ts';

const sample = [
  { id: 'a', name: 'Work', color: '#111', enabled: true, auto_block_others: true },
  { id: 'b', name: 'QA', color: '#222', enabled: false, auto_block_others: false },
];

describe('onboarding calendar step', () => {
  it('toggles enabled and preserves other fields', () => {
    const next = toggleCalendarEnabled(sample, 'b');
    expect(next.find((r) => r.id === 'b')).toMatchObject({
      enabled: true,
      name: 'QA',
      color: '#222',
    });
    expect(enabledCalendarCount(next)).toBe(2);
  });

  it('toggles auto-block without changing enabled', () => {
    const next = toggleAutoBlockOthers(sample, 'a');
    expect(next.find((r) => r.id === 'a')).toMatchObject({
      enabled: true,
      auto_block_others: false,
      name: 'Work',
    });
  });

  it('counts enabled calendars', () => {
    expect(enabledCalendarCount(sample)).toBe(1);
  });
});
