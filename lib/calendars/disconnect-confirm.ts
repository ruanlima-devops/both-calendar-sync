/**
 * Pure copy for calendar disconnect confirmation (web-safe via confirmAction).
 * No provider calls — UI only.
 */

export type DisconnectConfirmCopy = {
  title: string;
  message: string;
  cancel: string;
  confirm: string;
  destructive: true;
};

export function disconnectConfirmCopy(provider: string): DisconnectConfirmCopy {
  return {
    title: 'Desconectar',
    message:
      provider === 'ICLOUD'
        ? 'Remover esta conta? Você também pode revogar a senha específica de app em account.apple.com.'
        : 'Remover esta conta?',
    cancel: 'Cancelar',
    confirm: 'Desconectar',
    destructive: true,
  };
}
