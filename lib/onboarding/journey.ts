/**
 * Pure onboarding journey helpers — first-run clarity without live providers.
 */

export type OnboardingStepId = 'preferences' | 'connect' | 'calendars' | 'ready';

export const ONBOARDING_STEPS: OnboardingStepId[] = [
  'preferences',
  'connect',
  'calendars',
  'ready',
];

export type ConnectProviderResult =
  | { ok: true; calendarCount: number }
  | { ok: false; code: 'BUSY' | 'PROVIDER_DENIED' | 'NETWORK' | 'UNKNOWN'; message: string };

export function canAdvanceFromConnect(calendarCount: number): boolean {
  return calendarCount > 0;
}

export function canFinishOnboarding(input: {
  calendarCount: number;
  enabledCount: number;
}): { ok: true } | { ok: false; code: 'NO_CALENDARS' | 'NONE_ENABLED'; message: string } {
  if (input.calendarCount <= 0) {
    return {
      ok: false,
      code: 'NO_CALENDARS',
      message: 'Conecte pelo menos um calendário Google ou Microsoft para começar a sincronizar.',
    };
  }
  if (input.enabledCount <= 0) {
    return {
      ok: false,
      code: 'NONE_ENABLED',
      message: 'Ative pelo menos um calendário visível antes de continuar.',
    };
  }
  return { ok: true };
}

export function classifyProviderConnectError(error: unknown): ConnectProviderResult {
  const raw =
    typeof error === 'string'
      ? error
      : error instanceof Error
        ? error.message
        : typeof error === 'object' && error && 'message' in error
          ? String((error as { message?: unknown }).message ?? '')
          : '';
  const lower = raw.toLowerCase();
  if (lower.includes('busy') || lower.includes('in progress')) {
    return {
      ok: false,
      code: 'BUSY',
      message: 'Já existe uma conexão em andamento. Aguarde e tente novamente.',
    };
  }
  if (
    lower.includes('access_denied') ||
    lower.includes('consent') ||
    lower.includes('permission') ||
    lower.includes('denied')
  ) {
    return {
      ok: false,
      code: 'PROVIDER_DENIED',
      message:
        'Permissão negada no provedor. Autorize o acesso ao calendário e tente conectar de novo.',
    };
  }
  if (
    lower.includes('network') ||
    lower.includes('fetch') ||
    lower.includes('timeout') ||
    lower.includes('offline')
  ) {
    return {
      ok: false,
      code: 'NETWORK',
      message: 'Sem conexão. Verifique a internet e tente novamente.',
    };
  }
  return {
    ok: false,
    code: 'UNKNOWN',
    message:
      'Não foi possível conectar o calendário. Verifique a permissão no provedor e tente novamente.',
  };
}

export function firstSyncCopy(input: {
  status: 'idle' | 'running' | 'success' | 'failed';
  enabledCount: number;
}): { title: string; body: string } {
  switch (input.status) {
    case 'running':
      return {
        title: 'Primeira sincronização em andamento',
        body: 'Estamos alinhando seus calendários. Isso pode levar alguns minutos.',
      };
    case 'success':
      return {
        title: 'Sincronização inicial concluída',
        body: `${input.enabledCount} calendário(s) ativos. Novas alterações passam a refletir automaticamente.`,
      };
    case 'failed':
      return {
        title: 'Não concluímos a sincronização inicial',
        body: 'Você pode tentar de novo com segurança. Seus eventos existentes não foram apagados.',
      };
    default:
      return {
        title: 'Tudo pronto',
        body: 'A sincronização começa automaticamente quando houver eventos novos ou alterações.',
      };
  }
}
