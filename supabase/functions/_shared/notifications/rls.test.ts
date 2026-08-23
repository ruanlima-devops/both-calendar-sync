import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const sql = readFileSync(new URL('../../../migrations/20260819000005_notifications.sql', import.meta.url), 'utf8');

describe('notifications migration', () => {
  it('enables RLS and restricts authenticated writes', () => {
    expect(sql).toContain('alter table public.notifications enable row level security');
    expect(sql).toContain('notifications_select_own');
    expect(sql).toContain('revoke insert, update, delete on public.notifications from authenticated, anon');
    expect(sql).toContain('mark_notifications_read');
    expect(sql).toContain('alter publication supabase_realtime add table public.notifications');
    expect(sql).toContain('unique (user_id, dedupe_key)');
    expect(sql).toContain('replica identity full');
    expect(sql).not.toMatch(/disable row level security/);
  });
});
