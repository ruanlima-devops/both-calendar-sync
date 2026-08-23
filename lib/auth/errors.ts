export type GoogleAuthStatus = 'success' | 'cancelled' | 'redirecting' | 'busy' | 'error';

export type GoogleAuthResult =
  | { status: 'success' }
  | { status: 'cancelled' }
  | { status: 'redirecting' }
  | { status: 'busy' }
  | { status: 'error'; message: string };

const NETWORK_HINTS = [
  'network',
  'fetch',
  'failed to fetch',
  'network request failed',
  'internet',
  'offline',
  'timeout',
  'timed out',
  'econnrefused',
  'enetunreach',
];

const CANCEL_HINTS = [
  'cancel',
  'cancelled',
  'canceled',
  'dismiss',
  'dismissed',
  'access_denied',
  'user_cancelled',
  'user_canceled',
];

export const AUTH_MESSAGES = {
  googleFailed: 'Não foi possível entrar com o Google.\nTente novamente.',
  network: 'Sem conexão. Verifique a internet e tente novamente.',
} as const;

function rawMessage(error: unknown): string {
  if (typeof error === 'string') return error;
  if (error instanceof Error) return error.message;
  if (typeof error === 'object' && error && 'message' in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === 'string') return message;
  }
  return '';
}

export function isCancelledAuth(error: unknown): boolean {
  const raw = rawMessage(error).toLowerCase();
  return CANCEL_HINTS.some((hint) => raw.includes(hint));
}

export function isNetworkAuthError(error: unknown): boolean {
  const raw = rawMessage(error).toLowerCase();
  return NETWORK_HINTS.some((hint) => raw.includes(hint));
}

export function userMessageForAuthError(error: unknown): string {
  if (isCancelledAuth(error)) return '';
  if (isNetworkAuthError(error)) return AUTH_MESSAGES.network;
  return AUTH_MESSAGES.googleFailed;
}
