import { describe, expect, it, vi } from 'vitest';
import {
  confirmAndDeleteAccount,
  DELETE_ACCOUNT_ALERT,
  DELETE_ACCOUNT_CONFIRM_WORD,
  isDeleteAccountConfirmPhrase,
} from '@/lib/account/delete-account';

describe('delete account confirmation', () => {
  it('requires explicit EXCLUIR phrase', () => {
    expect(isDeleteAccountConfirmPhrase('')).toBe(false);
    expect(isDeleteAccountConfirmPhrase('delete')).toBe(false);
    expect(isDeleteAccountConfirmPhrase('excluir')).toBe(true);
    expect(isDeleteAccountConfirmPhrase('  EXCLUIR  ')).toBe(true);
    expect(DELETE_ACCOUNT_CONFIRM_WORD).toBe('EXCLUIR');
  });

  it('only deletes after explicit confirmation', async () => {
    const deleteAccount = vi.fn(async () => {});
    await expect(confirmAndDeleteAccount({ confirm: async () => false, deleteAccount })).resolves.toBe(false);
    expect(deleteAccount).not.toHaveBeenCalled();
    await expect(confirmAndDeleteAccount({ confirm: async () => true, deleteAccount })).resolves.toBe(true);
    expect(deleteAccount).toHaveBeenCalledTimes(1);
  });

  it('propagates delete failures to the caller', async () => {
    const failure = new Error('ACCOUNT_DELETE_BLOCKED');
    await expect(
      confirmAndDeleteAccount({ confirm: async () => true, deleteAccount: async () => Promise.reject(failure) }),
    ).rejects.toBe(failure);
  });

  it('exposes destructive confirmation copy', () => {
    expect(DELETE_ACCOUNT_ALERT.message.toLowerCase()).toContain('não pode ser desfeita');
    expect(DELETE_ACCOUNT_ALERT.message.toLowerCase()).toContain('calendário');
  });
});
