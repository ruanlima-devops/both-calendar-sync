export const DELETE_ACCOUNT_CONFIRM_WORD = 'EXCLUIR';

export function isDeleteAccountConfirmPhrase(value: string): boolean {
  return value.trim().toUpperCase() === DELETE_ACCOUNT_CONFIRM_WORD;
}

export const DELETE_ACCOUNT_ALERT = {
  title: 'Excluir conta',
  message:
    'Sua conta Both será excluída permanentemente. Conexões de calendário (Google/Microsoft/iCloud), eventos sincronizados e preferências serão removidos. Esta ação não pode ser desfeita.',
  cancel: 'Cancelar',
  confirm: 'Excluir',
} as const;

export async function confirmAndDeleteAccount(deps: {
  confirm: () => Promise<boolean>;
  deleteAccount: () => Promise<void>;
}): Promise<boolean> {
  if (!(await deps.confirm())) return false;
  await deps.deleteAccount();
  return true;
}
