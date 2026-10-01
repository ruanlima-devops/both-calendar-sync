import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeDb } from '../testing/fake-db.ts';
import { disconnectConnection } from './disconnect.ts';
import { AccountDeleteBlockedError } from './oauth-revoke.ts';

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
});

function world(provider: 'GOOGLE' | 'MICROSOFT') {
  return createFakeDb({
    calendar_connections: [
      { id: 'c1', user_id: 'u1', provider },
      { id: 'c-other', user_id: 'u2', provider },
    ],
    webhook_subscriptions: [
      { id: 'w1', connection_id: 'c1', external_subscription_id: 'ch-1', external_resource_id: 'res', expires_at: '2099-01-01', status: 'active' },
      { id: 'w0', connection_id: 'c1', external_subscription_id: 'ch-0', expires_at: '2099-01-01', status: 'expired' },
    ],
    calendar_secrets: [],
  });
}

function deps(deleteWebhook = vi.fn(async () => undefined), revoke = vi.fn(async () => 'revoked' as const)) {
  return {
    deleteWebhook,
    revoke,
    deps: {
      getAccessToken: vi.fn(async () => ({ accessToken: 'access', provider: 'GOOGLE' as const, userId: 'u1' })),
      revoke,
      providerForFn: (() => ({ deleteWebhookSubscription: deleteWebhook })) as never,
    },
  };
}

describe('disconnectConnection', () => {
  it('Google: stops active watches, revokes the grant, removes the connection', async () => {
    const { db, tables } = world('GOOGLE');
    const { deps: d, deleteWebhook, revoke } = deps();
    const result = await disconnectConnection(db, 'u1', 'c1', 'key', d);
    expect(deleteWebhook).toHaveBeenCalledTimes(1);
    expect(deleteWebhook.mock.calls[0]).toEqual(['access', { externalSubscriptionId: 'ch-1', externalResourceId: 'res', expiresAt: '2099-01-01' }]);
    expect(revoke).toHaveBeenCalledWith({ provider: 'GOOGLE', token: 'access' });
    expect(result).toEqual({ ok: true, removed: true, provider: 'GOOGLE', webhooksStopped: 1, webhooksAlreadyGone: 0, webhooksUnstopped: 0, revoke: 'revoked' });
    expect(tables.calendar_connections.map((c) => c.id)).toEqual(['c-other']);
  });

  it('Microsoft: deletes the Graph subscription and reports the skipped revoke', async () => {
    const { db, tables } = world('MICROSOFT');
    const { deps: d, deleteWebhook } = deps(undefined, vi.fn(async () => 'skipped' as const));
    const result = await disconnectConnection(db, 'u1', 'c1', 'key', d);
    expect(deleteWebhook).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ removed: true, provider: 'MICROSOFT', webhooksStopped: 1, revoke: 'skipped' });
    expect(tables.calendar_connections.some((c) => c.id === 'c1')).toBe(false);
  });

  it('is idempotent and never touches another user connection', async () => {
    const { db, tables } = world('GOOGLE');
    const { deps: d, deleteWebhook } = deps();
    await expect(disconnectConnection(db, 'u1', 'c-other', 'key', d)).resolves.toEqual({ ok: true, removed: false });
    await disconnectConnection(db, 'u1', 'c1', 'key', d);
    await expect(disconnectConnection(db, 'u1', 'c1', 'key', d)).resolves.toEqual({ ok: true, removed: false });
    expect(deleteWebhook).toHaveBeenCalledTimes(1);
    expect(tables.calendar_connections.map((c) => c.id)).toEqual(['c-other']);
  });

  it('treats an already-gone watch as stopped', async () => {
    const { db } = world('GOOGLE');
    const gone = vi.fn(async () => {
      throw Object.assign(new Error('not found'), { httpStatus: 404 });
    });
    const { deps: d } = deps(gone);
    await expect(disconnectConnection(db, 'u1', 'c1', 'key', d)).resolves.toMatchObject({ removed: true, webhooksAlreadyGone: 1 });
  });

  it('aborts on a transient provider failure and keeps the connection and credentials', async () => {
    const { db, tables } = world('GOOGLE');
    const transient = vi.fn(async () => {
      throw Object.assign(new Error('rate limited'), { code: 'RATE_LIMITED', httpStatus: 429 });
    });
    const { deps: d, revoke } = deps(transient);
    await expect(disconnectConnection(db, 'u1', 'c1', 'key', d)).rejects.toBeInstanceOf(AccountDeleteBlockedError);
    expect(revoke).not.toHaveBeenCalled();
    expect(tables.calendar_connections.some((c) => c.id === 'c1')).toBe(true);
  });

  it('still disconnects when the token is unusable (AUTH_REQUIRED)', async () => {
    const { db, tables } = world('GOOGLE');
    const { deps: d, deleteWebhook } = deps();
    d.getAccessToken = vi.fn(async () => {
      throw Object.assign(new Error('AUTH_REQUIRED'), { code: 'AUTH_REQUIRED', httpStatus: 401 });
    });
    const result = await disconnectConnection(db, 'u1', 'c1', 'key', d);
    expect(deleteWebhook).not.toHaveBeenCalled();
    expect(result).toMatchObject({ removed: true, webhooksUnstopped: 1, revoke: 'no_token' });
    expect(tables.calendar_connections.some((c) => c.id === 'c1')).toBe(false);
  });
});
