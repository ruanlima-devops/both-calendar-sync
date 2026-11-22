export type GoogleAuthStatus = 'success' | 'cancelled' | 'redirecting' | 'busy' | 'error';

export type GoogleAuthResult =
  | { status: 'success' }
  | { status: 'cancelled' }
  | { status: 'redirecting' }
  | { status: 'busy' }
  | { status: 'error'; message: string };

/** Safe, loggable categories — never include secrets or raw provider payloads. */
export type AuthErrorCategory =
  | 'AUTH_FAILED'
  | 'EMAIL_UNVERIFIED'
  | 'RATE_LIMITED'
  | 'SESSION_EXPIRED'
  | 'INVALID_RECOVERY_LINK'
  | 'WEAK_PASSWORD'
  | 'VALIDATION'
  | 'IDENTITY_CONFLICT'
  | 'NETWORK'
  | 'CANCELLED'
  | 'PLATFORM_ERROR';

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
  authFailed: 'Não foi possível entrar. Verifique e-mail e senha e tente novamente.',
  emailUnverified:
    'Confirme seu e-mail antes de entrar. Verifique sua caixa de entrada e o spam.',
  rateLimited: 'Muitas tentativas. Aguarde alguns minutos e tente novamente.',
  sessionExpired: 'Sua sessão expirou. Entre novamente.',
  invalidRecovery:
    'Este link de redefinição é inválido ou expirou. Solicite um novo e-mail.',
  weakPassword: 'A senha não atende aos requisitos de segurança.',
  validation: 'Revise os campos destacados e tente novamente.',
  identityConflict:
    'Não foi possível concluir com este e-mail. Entre com o método já usado nesta conta ou recupere o acesso.',
  signupCheckEmail:
    'Se este e-mail puder ser usado, enviamos um link de confirmação. Verifique sua caixa de entrada.',
  resetCheckEmail:
    'Se existir uma conta com este e-mail, enviamos instruções para redefinir a senha.',
  platform: 'Algo deu errado. Tente novamente em instantes.',
  passwordUpdated: 'Senha atualizada com sucesso.',
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

function statusCode(error: unknown): number | null {
  if (typeof error === 'object' && error && 'status' in error) {
    const status = (error as { status?: unknown }).status;
    if (typeof status === 'number') return status;
  }
  return null;
}

export function isCancelledAuth(error: unknown): boolean {
  const raw = rawMessage(error).toLowerCase();
  return CANCEL_HINTS.some((hint) => raw.includes(hint));
}

export function isNetworkAuthError(error: unknown): boolean {
  const raw = rawMessage(error).toLowerCase();
  return NETWORK_HINTS.some((hint) => raw.includes(hint));
}

export function classifyAuthError(error: unknown): AuthErrorCategory {
  if (isCancelledAuth(error)) return 'CANCELLED';
  if (isNetworkAuthError(error)) return 'NETWORK';

  const raw = rawMessage(error).toLowerCase();
  const status = statusCode(error);

  if (status === 429 || raw.includes('rate limit') || raw.includes('too many requests')) {
    return 'RATE_LIMITED';
  }
  if (
    raw.includes('email not confirmed') ||
    raw.includes('email_not_confirmed') ||
    raw.includes('not confirmed')
  ) {
    return 'EMAIL_UNVERIFIED';
  }
  if (
    raw.includes('otp_expired') ||
    raw.includes('flow_state') ||
    raw.includes('invalid recovery') ||
    (raw.includes('recovery') && raw.includes('expired')) ||
    raw.includes('token has expired') ||
    raw.includes('invalid token')
  ) {
    return 'INVALID_RECOVERY_LINK';
  }
  if (raw.includes('session') && (raw.includes('expired') || raw.includes('missing'))) {
    return 'SESSION_EXPIRED';
  }
  if (
    raw.includes('password should be') ||
    raw.includes('weak password') ||
    raw.includes('password is known')
  ) {
    return 'WEAK_PASSWORD';
  }
  if (
    raw.includes('already registered') ||
    raw.includes('already been registered') ||
    raw.includes('user already exists') ||
    raw.includes('identity is already linked') ||
    raw.includes('email address is already')
  ) {
    return 'IDENTITY_CONFLICT';
  }
  if (
    raw.includes('invalid login') ||
    raw.includes('invalid credentials') ||
    raw.includes('invalid email or password') ||
    raw.includes('email not found') ||
    raw.includes('user not found')
  ) {
    return 'AUTH_FAILED';
  }
  return 'PLATFORM_ERROR';
}

export function userMessageForAuthError(error: unknown, context: 'google' | 'password' = 'google'): string {
  const category = classifyAuthError(error);
  switch (category) {
    case 'CANCELLED':
      return '';
    case 'NETWORK':
      return AUTH_MESSAGES.network;
    case 'RATE_LIMITED':
      return AUTH_MESSAGES.rateLimited;
    case 'EMAIL_UNVERIFIED':
      return AUTH_MESSAGES.emailUnverified;
    case 'INVALID_RECOVERY_LINK':
      return AUTH_MESSAGES.invalidRecovery;
    case 'SESSION_EXPIRED':
      return AUTH_MESSAGES.sessionExpired;
    case 'WEAK_PASSWORD':
      return AUTH_MESSAGES.weakPassword;
    case 'IDENTITY_CONFLICT':
      return AUTH_MESSAGES.identityConflict;
    case 'AUTH_FAILED':
      return AUTH_MESSAGES.authFailed;
    case 'VALIDATION':
      return AUTH_MESSAGES.validation;
    case 'PLATFORM_ERROR':
    default:
      return context === 'google' ? AUTH_MESSAGES.googleFailed : AUTH_MESSAGES.platform;
  }
}

/** Safe signup UX: avoid confirming whether an e-mail already exists. */
export function userMessageForSignUpResult(category: AuthErrorCategory | 'ok'): string {
  if (category === 'ok' || category === 'IDENTITY_CONFLICT' || category === 'AUTH_FAILED') {
    return AUTH_MESSAGES.signupCheckEmail;
  }
  if (category === 'RATE_LIMITED') return AUTH_MESSAGES.rateLimited;
  if (category === 'WEAK_PASSWORD') return AUTH_MESSAGES.weakPassword;
  if (category === 'NETWORK') return AUTH_MESSAGES.network;
  if (category === 'VALIDATION') return AUTH_MESSAGES.validation;
  return AUTH_MESSAGES.platform;
}
