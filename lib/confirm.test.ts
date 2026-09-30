import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type AlertButton = { text: string; style?: string; onPress?: () => void };

const platform = { OS: 'web' as string };
const alert = vi.fn<(title: string, message?: string, buttons?: AlertButton[]) => void>();

vi.mock('react-native', () => ({ Platform: platform, Alert: { alert: (...args: unknown[]) => alert(...(args as [string])) } }));

const { confirmAction, showMessage } = await import('./confirm');
const { confirmAndDeleteAccount, DELETE_ACCOUNT_ALERT } = await import('@/lib/account/delete-account');

const options = { ...DELETE_ACCOUNT_ALERT, destructive: true };

describe('confirmAction on web', () => {
  const confirm = vi.fn<(message: string) => boolean>();
  const windowAlert = vi.fn();

  beforeEach(() => {
    platform.OS = 'web';
    confirm.mockReset();
    windowAlert.mockReset();
    alert.mockReset();
    vi.stubGlobal('window', { confirm, alert: windowAlert });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('shows a browser confirmation instead of the no-op RN Web Alert', async () => {
    confirm.mockReturnValue(false);
    await expect(confirmAction(options)).resolves.toBe(false);
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(confirm.mock.calls[0][0]).toContain(DELETE_ACCOUNT_ALERT.title);
    expect(confirm.mock.calls[0][0]).toContain('não pode ser desfeita');
    expect(alert).not.toHaveBeenCalled();
  });

  it('primary delete flow: cancel does not delete, confirm deletes once', async () => {
    const deleteAccount = vi.fn(async () => {});
    const run = () => confirmAndDeleteAccount({ confirm: () => confirmAction(options), deleteAccount });

    confirm.mockReturnValueOnce(false);
    await expect(run()).resolves.toBe(false);
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(deleteAccount).not.toHaveBeenCalled();

    confirm.mockReturnValueOnce(true);
    await expect(run()).resolves.toBe(true);
    expect(confirm).toHaveBeenCalledTimes(2);
    expect(deleteAccount).toHaveBeenCalledTimes(1);
  });

  it('fails closed when no browser dialog is available', async () => {
    vi.stubGlobal('window', {});
    const deleteAccount = vi.fn(async () => {});
    await expect(confirmAndDeleteAccount({ confirm: () => confirmAction(options), deleteAccount })).resolves.toBe(false);
    expect(deleteAccount).not.toHaveBeenCalled();
  });

  it('shows errors with window.alert on web', () => {
    showMessage('Both', 'Não foi possível excluir a conta.');
    expect(windowAlert).toHaveBeenCalledWith('Both\n\nNão foi possível excluir a conta.');
    expect(alert).not.toHaveBeenCalled();
  });
});

describe('confirmAction on native', () => {
  beforeEach(() => {
    platform.OS = 'ios';
    alert.mockReset();
  });

  it('keeps the native Cancelar/Excluir alert and resolves by button', async () => {
    const cancelled = confirmAction(options);
    const [title, message, buttons] = alert.mock.calls[0];
    expect(title).toBe(DELETE_ACCOUNT_ALERT.title);
    expect(message).toBe(DELETE_ACCOUNT_ALERT.message);
    expect(buttons?.map((b) => [b.text, b.style])).toEqual([
      ['Cancelar', 'cancel'],
      ['Excluir', 'destructive'],
    ]);
    buttons?.[0].onPress?.();
    await expect(cancelled).resolves.toBe(false);

    const confirmed = confirmAction(options);
    alert.mock.calls[1][2]?.[1].onPress?.();
    await expect(confirmed).resolves.toBe(true);
  });

  it('native delete flow runs the destructive handler only after Excluir', async () => {
    const deleteAccount = vi.fn(async () => {});
    const pending = confirmAndDeleteAccount({ confirm: () => confirmAction(options), deleteAccount });
    expect(deleteAccount).not.toHaveBeenCalled();
    alert.mock.calls[0][2]?.[1].onPress?.();
    await expect(pending).resolves.toBe(true);
    expect(deleteAccount).toHaveBeenCalledTimes(1);
  });

  it('shows errors with the native Alert', () => {
    showMessage('Both', 'x');
    expect(alert).toHaveBeenCalledWith('Both', 'x');
  });
});
