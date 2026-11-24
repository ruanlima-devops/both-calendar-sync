import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { disconnectConfirmCopy } from './disconnect-confirm.ts';

type AlertButton = { text: string; style?: string; onPress?: () => void };
const platform = { OS: 'web' as string };
const alert = vi.fn<(title: string, message?: string, buttons?: AlertButton[]) => void>();
vi.mock('react-native', () => ({
  Platform: platform,
  Alert: { alert: (...args: unknown[]) => alert(...(args as [string])) },
}));

const { confirmAction, showMessage } = await import('@/lib/confirm');

describe('disconnectConfirmCopy', () => {
  it('uses iCloud-specific revocation hint', () => {
    const c = disconnectConfirmCopy('ICLOUD');
    expect(c.title).toBe('Desconectar');
    expect(c.destructive).toBe(true);
    expect(c.message).toContain('account.apple.com');
    expect(c.cancel).toBe('Cancelar');
    expect(c.confirm).toBe('Desconectar');
  });

  it('uses short message for Google/Microsoft', () => {
    expect(disconnectConfirmCopy('GOOGLE').message).toBe('Remover esta conta?');
    expect(disconnectConfirmCopy('MICROSOFT').message).toBe('Remover esta conta?');
  });
});

describe('disconnect confirmAction cancel/confirm (web)', () => {
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

  it('cancel does not proceed (false)', async () => {
    confirm.mockReturnValue(false);
    const opts = disconnectConfirmCopy('GOOGLE');
    await expect(confirmAction(opts)).resolves.toBe(false);
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(alert).not.toHaveBeenCalled();
  });

  it('confirm proceeds (true)', async () => {
    confirm.mockReturnValue(true);
    await expect(confirmAction(disconnectConfirmCopy('MICROSOFT'))).resolves.toBe(true);
  });

  it('fails closed without window.confirm', async () => {
    vi.stubGlobal('window', {});
    await expect(confirmAction(disconnectConfirmCopy('ICLOUD'))).resolves.toBe(false);
  });

  it('showMessage uses window.alert on web', () => {
    showMessage('Both', 'Não foi possível desconectar a conta.');
    expect(windowAlert).toHaveBeenCalledWith('Both\n\nNão foi possível desconectar a conta.');
  });
});

describe('calendars.tsx Alert regression', () => {
  it('does not call Alert.alert; uses confirmAction/showMessage', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(new URL('../../app/(app)/(tabs)/calendars.tsx', import.meta.url), 'utf8');
    expect(src).not.toMatch(/Alert\.alert/);
    expect(src).toMatch(/confirmAction/);
    expect(src).toMatch(/showMessage/);
    expect(src).toMatch(/from '@\/lib\/confirm'/);
  });
});
