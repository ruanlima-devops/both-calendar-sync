/** SYN-05 Gate B watchdog — shared types (local / dry-run). */

export const STAGE_PROJECT_REF = 'qszggrrjhcwltnmxpxcy' as const;
export const STAGE_ENVIRONMENT = 'stage' as const;
export const MANAGEMENT_API_HOST = 'api.supabase.com' as const;

export type EvaluationStatus =
  | 'HEALTHY'
  | 'FIRING'
  | 'UNKNOWN'
  | 'DATA_UNAVAILABLE'
  | 'RECOVERING'
  | 'RESOLVED';

export type Severity = 'P0' | 'P1' | 'P2';

export type LogSource = 'function_edge_logs' | 'function_logs' | 'postgres_logs';

export type NormalizedSignal =
  | {
      kind: 'edge_http';
      timestamp: string;
      method?: string;
      status: number;
      functionName: string;
      path?: string;
    }
  | {
      kind: 'console_event';
      timestamp: string;
      event_name: string;
      message?: string;
      outcome?: string;
      provider?: string;
      raw_keys: string[];
    }
  | {
      kind: 'pg_cron_start';
      timestamp: string;
      jobHint: string;
    };

export type AlertEvaluation = {
  alert_id: 'ALERT-01' | 'ALERT-02' | 'ALERT-03' | 'ALERT-SELF';
  severity: Severity;
  environment: typeof STAGE_ENVIRONMENT;
  project_ref: typeof STAGE_PROJECT_REF;
  evaluation_status: EvaluationStatus;
  observed_count: number;
  time_window: { start: string; end: string };
  fingerprint: string;
  evidence_summary: string;
  function_or_service?: string;
};

export type IncidentRecord = {
  fingerprint: string;
  alert_id: string;
  number: number;
  title: string;
  state: 'open' | 'closed';
  labels: string[];
  body: string;
  opened_at: string;
  last_seen_at: string;
  resolved_at?: string;
  bot_marker: string;
  consecutive_healthy: number;
};

export type ReconcileAction =
  | { type: 'create'; evaluation: AlertEvaluation }
  | { type: 'update'; incident: IncidentRecord; evaluation: AlertEvaluation }
  | { type: 'resolve'; incident: IncidentRecord; evaluation: AlertEvaluation }
  | { type: 'noop'; reason: string; evaluation?: AlertEvaluation; incident?: IncidentRecord };

export type WatchdogRunResult = {
  dry_run: boolean;
  project_ref: string;
  evaluated_at: string;
  evaluations: AlertEvaluation[];
  actions: ReconcileAction[];
  data_available: boolean;
  api_error?: string;
};

export const BOT_LABEL = 'both-watchdog';
export const BOT_MARKER = '<!-- both-syn05-watchdog -->';
export const BOT_FINGERPRINT_PREFIX = 'both-syn05-fp:';
