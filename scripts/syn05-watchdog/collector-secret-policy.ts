/**
 * SYN-05 collector secret isolation — policy helpers (offline, no network).
 * Documents fail-closed decisions until COLLECTOR_SECRET_STORAGE is unblocked.
 */

export type CollectorSecretStorageState =
  | 'BLOCKED'
  | 'GITHUB_ENVIRONMENT_CANDIDATE'
  | 'OIDC_VAULT_CANDIDATE'
  | 'SPLIT_IDENTITY_CANDIDATE';

export type CollectorActivationGate = {
  githubAppCertified: boolean;
  cloudflareWorkerRemoteEnabled: boolean;
  betterStackUnpaused: boolean;
  supabasePatIssued: boolean;
  collectorSecretStorage: CollectorSecretStorageState;
  watchdogRemoteEnabled: boolean;
  observerRemoteEnabled: boolean;
  c3dScheduleOn: boolean;
  deliveryOn: boolean;
};

export type CollectorGoNoGo = {
  decision: 'NO-GO' | 'CONDITIONAL' | 'GO';
  blockers: string[];
  residualRisks: string[];
};

export const CURRENT_COLLECTOR_GATE: CollectorActivationGate = {
  githubAppCertified: true,
  cloudflareWorkerRemoteEnabled: false,
  betterStackUnpaused: false,
  supabasePatIssued: false,
  collectorSecretStorage: 'BLOCKED',
  watchdogRemoteEnabled: false,
  observerRemoteEnabled: false,
  c3dScheduleOn: false,
  deliveryOn: false,
};

/** Options ranked for STAGE without paid vaulting. */
export const COLLECTOR_SECRET_OPTIONS = [
  {
    id: 'A_github_environment_job_isolation',
    title: 'GitHub Environment + job isolation',
    cost: 'none',
    isolatesFrom: 'workflow_dispatch by unauthorized actors referencing the environment',
    residual:
      'Any collaborator who can approve/use the environment may still reach secrets; needs required reviewers + deployment branch policy',
    recommendation: 'preferred_if_reviewers_enforced',
  },
  {
    id: 'B_oidc_to_supabase_management',
    title: 'OIDC federated identity to Supabase Management (if supported)',
    cost: 'none_if_supported',
    isolatesFrom: 'long-lived PAT in Actions secrets',
    residual: 'Platform support for analytics_logs_read via OIDC is unverified — treat as research',
    recommendation: 'research_only_until_proven',
  },
  {
    id: 'C_split_read_identities',
    title: 'Split collector vs delivery identities',
    cost: 'none',
    isolatesFrom: 'single secret usable for both log read and issue write',
    residual: 'Still needs secure storage for the log-read credential',
    recommendation: 'always_combine_with_A',
  },
  {
    id: 'D_keep_blocked',
    title: 'Keep COLLECTOR_SECRET_STORAGE=BLOCKED',
    cost: 'none',
    isolatesFrom: 'accidental live log ingestion',
    residual: 'SYN-05 remains NO-GO for collector path',
    recommendation: 'current_default',
  },
] as const;

export function evaluateCollectorGoNoGo(gate: CollectorActivationGate = CURRENT_COLLECTOR_GATE): CollectorGoNoGo {
  const blockers: string[] = [];
  const residualRisks: string[] = [];

  if (gate.collectorSecretStorage === 'BLOCKED') {
    blockers.push('COLLECTOR_SECRET_STORAGE=BLOCKED — no proven isolated store for Supabase logs PAT');
  }
  if (!gate.supabasePatIssued) {
    blockers.push('Supabase Logs Read PAT not issued (correct until isolation proven)');
  }
  if (gate.cloudflareWorkerRemoteEnabled) {
    blockers.push('Cloudflare worker unexpectedly remote-enabled');
  }
  if (gate.betterStackUnpaused) {
    blockers.push('Better Stack heartbeat unexpectedly unpaused');
  }
  if (gate.watchdogRemoteEnabled || gate.observerRemoteEnabled) {
    blockers.push('Watchdog/Observer remote enabled while collector storage unresolved');
  }
  if (gate.c3dScheduleOn || gate.deliveryOn) {
    blockers.push('Schedule or delivery ON while collector NO-GO');
  }
  if (!gate.githubAppCertified) {
    blockers.push('GitHub App installation not certified');
  }

  residualRisks.push('Fine-grained PAT still broad relative to ideal logs-read-only posture');
  residualRisks.push('GitHub Environment isolation requires reviewer + branch policies to be meaningful');
  residualRisks.push('Workflow files on default branch can still request environments — review permissions carefully');

  if (blockers.length > 0) {
    return { decision: 'NO-GO', blockers, residualRisks };
  }
  return {
    decision: 'CONDITIONAL',
    blockers,
    residualRisks,
  };
}

export function assertNoLiveCollectorMutation(intent: {
  emitPat?: boolean;
  createEnvironment?: boolean;
  unpauseBetterStack?: boolean;
  enableCron?: boolean;
  callLogsApi?: boolean;
}): { allowed: boolean; refused: string[] } {
  const refused: string[] = [];
  if (intent.emitPat) refused.push('emit_pat');
  if (intent.createEnvironment) refused.push('create_environment');
  if (intent.unpauseBetterStack) refused.push('unpause_better_stack');
  if (intent.enableCron) refused.push('enable_cron');
  if (intent.callLogsApi) refused.push('call_logs_api');
  return { allowed: refused.length === 0, refused };
}
