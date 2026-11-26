/**
 * C3-B.4.1 — Evaluator boundary (logical).
 * No HTTP. No Supabase PAT. No GitHub Issues. Pure evaluation + artifact emission.
 */

import { evaluateAll } from './evaluation.ts';
import {
  buildDeliveryArtifact,
  type ArtifactValidationResult,
  type DeliveryArtifactV1,
  type DeliveryCompleteness,
} from './delivery-artifact.ts';
import type { CollectorResult } from './collector.ts';
import type { AlertEvaluation, NormalizedSignal } from './types.ts';

export type EvaluatorInput = {
  signals: NormalizedSignal[];
  dataAvailable: boolean;
  apiError?: string;
  nowMs?: number;
  completeness?: DeliveryCompleteness;
  evaluation_run_id: string;
  source_commit_sha: string;
};

export type EvaluatorOutput = {
  evaluations: AlertEvaluation[];
  artifacts: ArtifactValidationResult[];
  completeness: DeliveryCompleteness;
};

const ISO_Z = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;

function coerceIsoWindow(start: string, end: string, nowMs: number): { start: string; end: string } {
  if (ISO_Z.test(start) && ISO_Z.test(end) && Date.parse(start) < Date.parse(end)) {
    return { start, end };
  }
  const endIso = new Date(nowMs).toISOString();
  const startIso = new Date(nowMs - 10 * 60_000).toISOString();
  return { start: startIso, end: endIso };
}

/** Map AlertEvaluation → delivery artifact (derived fields only). */
export function evaluationToArtifactDraft(
  ev: AlertEvaluation,
  meta: {
    completeness: DeliveryCompleteness;
    evaluation_run_id: string;
    source_commit_sha: string;
    nowMs?: number;
  },
): ArtifactValidationResult {
  const win = coerceIsoWindow(ev.time_window.start, ev.time_window.end, meta.nowMs ?? Date.now());
  return buildDeliveryArtifact({
    alert_id: ev.alert_id,
    fingerprint: ev.fingerprint,
    evaluation_status: ev.evaluation_status,
    sample_window_start: win.start,
    sample_window_end: win.end,
    event_count: Math.max(0, Math.floor(ev.observed_count)),
    completeness: meta.completeness,
    evaluation_run_id: meta.evaluation_run_id,
    source_commit_sha: meta.source_commit_sha,
  });
}

export function evaluateCollected(input: EvaluatorInput): EvaluatorOutput {
  const completeness = input.completeness ?? (input.apiError === 'result_truncated' ? 'incomplete' : 'complete');
  const nowMs = input.nowMs ?? Date.now();
  let evaluations = evaluateAll({
    signals: input.signals,
    dataAvailable: input.dataAvailable,
    apiError: input.apiError,
    nowMs,
  });

  if (completeness === 'incomplete' || input.apiError === 'result_truncated') {
    evaluations = evaluations.map((ev) =>
      ev.evaluation_status === 'HEALTHY'
        ? { ...ev, evaluation_status: 'UNKNOWN' as const, evidence_summary: 'result_truncated_unknown' }
        : ev,
    );
  }

  const artifacts = evaluations.map((ev) =>
    evaluationToArtifactDraft(ev, {
      completeness,
      evaluation_run_id: input.evaluation_run_id,
      source_commit_sha: input.source_commit_sha,
      nowMs,
    }),
  );

  return { evaluations, artifacts, completeness };
}

export function evaluateFromCollector(
  collected: CollectorResult,
  meta: { evaluation_run_id: string; source_commit_sha: string; nowMs?: number },
): EvaluatorOutput {
  return evaluateCollected({
    signals: collected.signals,
    dataAvailable: collected.data_available,
    apiError: collected.api_error,
    completeness: collected.completeness,
    evaluation_run_id: meta.evaluation_run_id,
    source_commit_sha: meta.source_commit_sha,
    nowMs: meta.nowMs,
  });
}

/** Type export for documentation — artifacts never include evidence_summary raw text as freeform. */
export type DerivedArtifact = DeliveryArtifactV1;

export const EVALUATOR_FORBIDS_REMOTE_HTTP = true as const;
export const EVALUATOR_FORBIDS_GITHUB_ISSUES = true as const;
