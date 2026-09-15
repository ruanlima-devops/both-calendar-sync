import { describe, expect, it } from 'vitest';
import {
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

  it('exposes destructive confirmation copy', () => {
    expect(DELETE_ACCOUNT_ALERT.message.toLowerCase()).toContain('não pode ser desfeita');
    expect(DELETE_ACCOUNT_ALERT.message.toLowerCase()).toContain('calendário');
  });
});
