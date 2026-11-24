/**
 * STG-06B — calendar lifecycle helpers (pure, deterministic).
 * Disconnect/reconnect execution stays gated; these helpers never call providers.
 */

export type ConnectionProvider = 'GOOGLE' | 'MICROSOFT' | 'ICLOUD';
export type ConnectionStatus = 'CONNECTED' | 'SYNCING' | 'AUTH_REQUIRED' | string;

export type ConnectionCardView = {
  provider: ConnectionProvider;
  status: ConnectionStatus;
  statusLabel: string;
  statusTone: 'ok' | 'busy' | 'action' | 'error';
  showReconnect: boolean;
  showDisconnect: boolean;
  enabledCalendarCount: number;
};

export type DisconnectPrep = {
  allowed: boolean;
  code: 'OK' | 'MISSING_OPT_IN' | 'UNKNOWN_PROVIDER' | 'WRONG_USER';
  reason: string;
  provider: ConnectionProvider | null;
  connectionId: string | null;
};

const DISCONNECT_OPT_IN = 'BOTH_TEST_ALLOW_DISCONNECT';

export function connectionStatusView(status: ConnectionStatus): Pick<
  ConnectionCardView,
  'statusLabel' | 'statusTone' | 'showReconnect'
> {
  switch (status) {
    case 'CONNECTED':
      return { statusLabel: 'Conectado', statusTone: 'ok', showReconnect: false };
    case 'SYNCING':
      return { statusLabel: 'Sincronizando', statusTone: 'busy', showReconnect: false };
    case 'AUTH_REQUIRED':
      return { statusLabel: 'Reconectar', statusTone: 'action', showReconnect: true };
    default:
      return { statusLabel: String(status), statusTone: 'error', showReconnect: true };
  }
}

export function buildConnectionCardView(input: {
  provider: ConnectionProvider;
  status: ConnectionStatus;
  enabledCalendarCount: number;
}): ConnectionCardView {
  const status = connectionStatusView(input.status);
  return {
    provider: input.provider,
    status: input.status,
    statusLabel: status.statusLabel,
    statusTone: status.statusTone,
    showReconnect: status.showReconnect,
    showDisconnect: true,
    enabledCalendarCount: input.enabledCalendarCount,
  };
}

/**
 * Dry-run gate for disconnect E2E. Default: refused (protects QA credentials).
 * Real disconnect requires explicit BOTH_TEST_ALLOW_DISCONNECT=1 in a future authorized run.
 */
export function prepareDisconnect(input: {
  connectionId: string;
  provider: ConnectionProvider;
  ownerUserId: string;
  sessionUserId: string;
  env?: Record<string, string | undefined>;
}): DisconnectPrep {
  const env = input.env ?? process.env;
  if (input.ownerUserId !== input.sessionUserId) {
    return {
      allowed: false,
      code: 'WRONG_USER',
      reason: 'Disconnect refused: connection does not belong to the QA session user',
      provider: input.provider,
      connectionId: input.connectionId,
    };
  }
  if (input.provider !== 'GOOGLE' && input.provider !== 'MICROSOFT' && input.provider !== 'ICLOUD') {
    return {
      allowed: false,
      code: 'UNKNOWN_PROVIDER',
      reason: 'Disconnect refused: unknown provider',
      provider: null,
      connectionId: input.connectionId,
    };
  }
  const opted = env[DISCONNECT_OPT_IN] === '1' || env[DISCONNECT_OPT_IN] === 'true';
  if (!opted) {
    return {
      allowed: false,
      code: 'MISSING_OPT_IN',
      reason: `Disconnect dry-run only — set ${DISCONNECT_OPT_IN}=1 in an authorized run (revokes QA provider credentials)`,
      provider: input.provider,
      connectionId: input.connectionId,
    };
  }
  return {
    allowed: true,
    code: 'OK',
    reason: 'Disconnect authorized for isolated provider run',
    provider: input.provider,
    connectionId: input.connectionId,
  };
}

export function isolateProviderConnections<T extends { provider: ConnectionProvider }>(
  rows: T[],
  provider: ConnectionProvider,
): T[] {
  return rows.filter((row) => row.provider === provider);
}

export { DISCONNECT_OPT_IN };
