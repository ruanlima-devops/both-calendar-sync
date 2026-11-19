import { describe, expect, it } from 'vitest';
import { listChangedPaths } from './list-changed-paths.ts';

describe('listChangedPaths fail-closed', () => {
  it('missing base/head → not ok', () => {
    expect(listChangedPaths('', 'abc').ok).toBe(false);
    expect(listChangedPaths('abc', '').reason).toBe('missing_base_or_head');
  });

  it('base equals head → not ok', () => {
    const r = listChangedPaths('abc', 'abc');
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('base_equals_head');
  });
});
