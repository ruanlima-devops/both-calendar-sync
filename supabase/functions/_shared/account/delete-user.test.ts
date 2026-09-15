import { describe, expect, it, vi } from 'vitest';
import { AccountDeleteBlockedError } from './oauth-revoke.ts';
import { deleteUserAccount } from './delete-user.ts';

type TableState = Record<string, Array<Record<string, unknown>>>;

function createFakeDb(initial: TableState) {
  const tables: TableState = structuredClone(initial);
  const authDelete = vi.fn(async (_id: string) => ({ error: null as { message: string } | null }));

  function from(table: string) {
    let filters: Array<(row: Record<string, unknown>) => boolean> = [];
    let updatePatch: Record<string, unknown> | null = null;
    let doDelete = false;
    let inFilter: { col: string; values: unknown[] } | null = null;

    const runSelect = () => {
      let rows = [...(tables[table] ?? [])];
      for (const f of filters) rows = rows.filter(f);
      if (inFilter) rows = rows.filter((r) => inFilter!.values.includes(r[inFilter!.col]));
      return rows;
    };

    const applyMutations = async () => {
      if (updatePatch) {
        for (const row of runSelect()) Object.assign(row, updatePatch);
        return { data: runSelect(), error: null };
      }
      if (doDelete) {
        tables[table] = (tables[table] ?? []).filter((row) => {
          const matchFilters = filters.every((f) => f(row));
          const matchIn = inFilter ? inFilter.values.includes(row[inFilter.col]) : true;
          return !(matchFilters && matchIn);
        });
        return { data: null, error: null };
      }
      return { data: runSelect(), error: null };
    };

    const thenable = {
      eq(col: string, value: unknown) {
        filters.push((row) => row[col] === value);
        return thenable;
      },
      in(col: string, values: unknown[]) {
        inFilter = { col, values };
        return thenable;
      },
      select(_cols?: string) {
        return thenable;
      },
      update(patch: Record<string, unknown>) {
        updatePatch = patch;
        return thenable;
      },
      delete() {
        doDelete = true;
        return thenable;
      },
      maybeSingle: async () => {
        const rows = runSelect();
        return { data: rows[0] ?? null, error: null };
      },
      single: async () => {
        const rows = runSelect();
        return { data: rows[0] ?? null, error: rows[0] ? null : { message: 'not found' } };
      },
      then(resolve: (v: unknown) => void, reject?: (e: unknown) => void) {
        return applyMutations().then(resolve, reject);
      },
    };
    return thenable;
  }

  return {
    db: {
      from,
      auth: { admin: { deleteUser: (id: string) => authDelete(id) } },
    } as unknown as Parameters<typeof deleteUserAccount>[0],
    tables,
    authDelete,
  };
}

describe('deleteUserAccount', () => {
  it('cancels open jobs, removes connections/profile, deletes auth user', async () => {
    const { db, tables, authDelete } = createFakeDb({
      sync_jobs: [
        { id: 'job-1', user_id: 'u1', status: 'pending' },
        { id: 'job-2', user_id: 'u1', status: 'completed' },
      ],
      calendar_connections: [{ id: 'c1', user_id: 'u1', provider: 'GOOGLE' }],
      webhook_subscriptions: [
        {
          id: 'w1',
          connection_id: 'c1',
          external_subscription_id: 'ch',
          external_resource_id: 'res',
          expires_at: '2099-01-01',
          status: 'active',
        },
      ],
      calendar_secrets: [],
      scheduling_links: [{ id: 'sl1', user_id: 'u1' }],
      oauth_states: [{ id: 'os1', user_id: 'u1' }],
      notifications: [{ id: 'n1', user_id: 'u1' }],
      billing_events: [{ id: 'b1', user_id: 'u1' }],
      user_subscriptions: [{ id: 's1', user_id: 'u1' }],
      email_digest_log: [],
      calendar_firewall_rules: [],
      profiles: [{ id: 'u1', display_name: 'A' }],
    });

    const deleteWebhook = vi.fn(async () => undefined);
    const revoke = vi.fn(async () => 'revoked' as const);

    const result = await deleteUserAccount(db, 'u1', 'test-key', {
      getAccessToken: async () => ({ accessToken: 'access', provider: 'GOOGLE', userId: 'u1' }),
      revoke,
      providerForFn: () =>
        ({
          deleteWebhookSubscription: deleteWebhook,
        }) as ReturnType<NonNullable<Parameters<typeof deleteUserAccount>[3]>['providerForFn']>,
    });

    expect(result.ok).toBe(true);
    expect(result.jobsCancelled).toBe(1);
    expect(result.connectionsCleaned).toBe(1);
    expect(result.authDeleted).toBe(true);
    expect(authDelete).toHaveBeenCalledWith('u1');
    expect(deleteWebhook).toHaveBeenCalledOnce();
    expect(revoke).toHaveBeenCalledWith({ provider: 'GOOGLE', token: 'access' });
    expect(tables.sync_jobs.find((j) => j.id === 'job-1')?.status).toBe('failed');
    expect(tables.sync_jobs.find((j) => j.id === 'job-1')?.error).toBe('account_deleted');
    expect(tables.calendar_connections).toHaveLength(0);
    expect(tables.scheduling_links).toHaveLength(0);
    expect(tables.profiles).toHaveLength(0);
    expect(tables.billing_events[0]?.user_id).toBeNull();
  });

  function baseWithActiveSub(provider: 'GOOGLE' | 'MICROSOFT') {
    return createFakeDb({
      sync_jobs: [],
      calendar_connections: [{ id: 'c1', user_id: 'u1', provider }],
      webhook_subscriptions: [
        {
          id: 'w1',
          connection_id: 'c1',
          external_subscription_id: 'sub',
          external_resource_id: 'res',
          expires_at: '2099-01-01',
          status: 'active',
        },
      ],
      calendar_secrets: [{ connection_id: 'c1', encrypted_refresh_token: 'enc' }],
      scheduling_links: [],
      oauth_states: [],
      notifications: [],
      billing_events: [],
      user_subscriptions: [],
      email_digest_log: [],
      calendar_firewall_rules: [],
      profiles: [{ id: 'u1' }],
    });
  }

  it('continues when provider returns 404 (idempotent missing)', async () => {
    const { db, tables, authDelete } = baseWithActiveSub('MICROSOFT');
    const result = await deleteUserAccount(db, 'u1', 'test-key', {
      getAccessToken: async () => ({ accessToken: 'access', provider: 'MICROSOFT', userId: 'u1' }),
      revoke: async () => 'skipped',
      providerForFn: () =>
        ({
          deleteWebhookSubscription: async () => {
            throw Object.assign(new Error('not found'), { httpStatus: 404 });
          },
        }) as ReturnType<NonNullable<Parameters<typeof deleteUserAccount>[3]>['providerForFn']>,
    });
    expect(result.ok).toBe(true);
    expect(result.authDeleted).toBe(true);
    expect(authDelete).toHaveBeenCalled();
    expect(tables.calendar_connections).toHaveLength(0);
    expect(tables.profiles).toHaveLength(0);
  });

  it('continues when provider returns 410 (gone)', async () => {
    const { db, tables } = baseWithActiveSub('GOOGLE');
    const result = await deleteUserAccount(db, 'u1', 'test-key', {
      getAccessToken: async () => ({ accessToken: 'access', provider: 'GOOGLE', userId: 'u1' }),
      revoke: async () => 'failed',
      providerForFn: () =>
        ({
          deleteWebhookSubscription: async () => {
            throw Object.assign(new Error('gone'), { httpStatus: 410 });
          },
        }) as ReturnType<NonNullable<Parameters<typeof deleteUserAccount>[3]>['providerForFn']>,
    });
    expect(result.ok).toBe(true);
    expect(tables.calendar_connections).toHaveLength(0);
    expect(tables.profiles).toHaveLength(0);
  });

  it('aborts on provider 429 and preserves credentials', async () => {
    const { db, tables, authDelete } = baseWithActiveSub('GOOGLE');
    await expect(
      deleteUserAccount(db, 'u1', 'test-key', {
        getAccessToken: async () => ({ accessToken: 'access', provider: 'GOOGLE', userId: 'u1' }),
        revoke: async () => 'revoked',
        providerForFn: () =>
          ({
            deleteWebhookSubscription: async () => {
              throw Object.assign(new Error('rate'), {
                httpStatus: 429,
                code: 'RATE_LIMITED',
              });
            },
          }) as ReturnType<NonNullable<Parameters<typeof deleteUserAccount>[3]>['providerForFn']>,
      }),
    ).rejects.toBeInstanceOf(AccountDeleteBlockedError);
    expect(tables.calendar_connections).toHaveLength(1);
    expect(tables.calendar_secrets).toHaveLength(1);
    expect(tables.profiles).toHaveLength(1);
    expect(authDelete).not.toHaveBeenCalled();
  });

  it('aborts on provider 5xx and preserves credentials', async () => {
    const { db, tables, authDelete } = baseWithActiveSub('MICROSOFT');
    await expect(
      deleteUserAccount(db, 'u1', 'test-key', {
        getAccessToken: async () => ({ accessToken: 'access', provider: 'MICROSOFT', userId: 'u1' }),
        revoke: async () => 'skipped',
        providerForFn: () =>
          ({
            deleteWebhookSubscription: async () => {
              throw Object.assign(new Error('unavailable'), {
                httpStatus: 503,
                code: 'PROVIDER_UNAVAILABLE',
              });
            },
          }) as ReturnType<NonNullable<Parameters<typeof deleteUserAccount>[3]>['providerForFn']>,
      }),
    ).rejects.toBeInstanceOf(AccountDeleteBlockedError);
    expect(tables.calendar_connections).toHaveLength(1);
    expect(tables.calendar_secrets).toHaveLength(1);
    expect(tables.profiles).toHaveLength(1);
    expect(authDelete).not.toHaveBeenCalled();
  });

  it('aborts on provider timeout and preserves credentials', async () => {
    const { db, tables, authDelete } = baseWithActiveSub('GOOGLE');
    await expect(
      deleteUserAccount(db, 'u1', 'test-key', {
        getAccessToken: async () => ({ accessToken: 'access', provider: 'GOOGLE', userId: 'u1' }),
        revoke: async () => 'revoked',
        providerForFn: () =>
          ({
            deleteWebhookSubscription: async () => {
              throw Object.assign(new Error('timeout'), { code: 'TIMEOUT' });
            },
          }) as ReturnType<NonNullable<Parameters<typeof deleteUserAccount>[3]>['providerForFn']>,
      }),
    ).rejects.toBeInstanceOf(AccountDeleteBlockedError);
    expect(tables.calendar_connections).toHaveLength(1);
    expect(tables.calendar_secrets).toHaveLength(1);
    expect(tables.profiles).toHaveLength(1);
    expect(authDelete).not.toHaveBeenCalled();
  });

  it('treats auth user already missing as success', async () => {
    const { db, authDelete } = createFakeDb({
      sync_jobs: [],
      calendar_connections: [],
      webhook_subscriptions: [],
      calendar_secrets: [],
      scheduling_links: [],
      oauth_states: [],
      notifications: [],
      billing_events: [],
      user_subscriptions: [],
      email_digest_log: [],
      calendar_firewall_rules: [],
      profiles: [],
    });
    authDelete.mockResolvedValueOnce({ error: { message: 'User not found' } });
    const result = await deleteUserAccount(db, 'u-missing', 'test-key', {
      getAccessToken: async () => {
        throw new Error('unused');
      },
    });
    expect(result.authDeleted).toBe(true);
  });
});
