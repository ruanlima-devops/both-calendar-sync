/**
 * C3-B.4.1 — Delivery boundary (logical).
 * Consumes validated artifacts only. Real HttpGithubIssues remains disabled.
 * No HTTP in this phase. Write gate fail-closed.
 */

import {
  parseDeliveryArtifactJson,
  verifyArtifactProvenance,
  assertSafeArtifactPath,
  mayMutateIssuesFromArtifact,
  type ArtifactValidationOk,
  type ArtifactValidationResult,
  type DeliveryArtifactV1,
  type ProvenanceContext,
} from './delivery-artifact.ts';
import {
  defaultC0Env,
  evaluateWriteGate,
  type WriteGateDecision,
  type WriteGateEnv,
} from './write-gate.ts';

export type DeliveryAttemptResult = {
  accepted: boolean;
  code: string;
  write_gate: WriteGateDecision;
  artifact?: DeliveryArtifactV1;
  planned_op?: 'noop' | 'create' | 'update' | 'reopen' | 'close';
};

/**
 * Simulate delivery from JSON payload — never calls GitHub.
 * Always fail-closed under C0 / C3-B.4.1 defaults.
 */
export function attemptDeliveryFromJson(
  rawJson: string,
  opts: {
    env?: WriteGateEnv;
    provenance: ProvenanceContext;
    artifact_path?: string;
    permission_issues_write_available?: boolean;
    adapter_enabled?: boolean;
    token_present?: boolean;
  },
): DeliveryAttemptResult {
  const env = defaultC0Env(opts.env ?? {});

  if (opts.artifact_path) {
    const pathCheck = assertSafeArtifactPath(opts.artifact_path);
    if (!pathCheck.ok) {
      return {
        accepted: false,
        code: pathCheck.code,
        write_gate: { authorized: false, code: pathCheck.code, mode: 'blocked' },
        planned_op: 'noop',
      };
    }
  }

  const parsed = parseDeliveryArtifactJson(rawJson);
  if (!parsed.ok) {
    return {
      accepted: false,
      code: parsed.code,
      write_gate: { authorized: false, code: parsed.code, mode: 'blocked' },
      planned_op: 'noop',
    };
  }

  const proven = verifyArtifactProvenance(parsed, opts.provenance);
  if (!proven.ok) {
    return {
      accepted: false,
      code: proven.code,
      write_gate: { authorized: false, code: proven.code, mode: 'blocked' },
      planned_op: 'noop',
    };
  }

  const validated = proven as ArtifactValidationOk;
  const gate = evaluateWriteGate({
    env,
    artifact: validated.artifact,
    validated,
    permission_issues_write_available: opts.permission_issues_write_available ?? false,
    adapter_enabled: opts.adapter_enabled ?? false,
    token_present: opts.token_present ?? false,
    trusted_provenance: true,
    concurrency_ok: true,
    within_authorized_window: true,
    operations_remaining: 1,
    repo_full_name: 'ruanlima-devops/both-calendar-sync',
  });

  if (!gate.authorized) {
    return {
      accepted: false,
      code: gate.code,
      write_gate: gate,
      artifact: validated.artifact,
      planned_op: 'noop',
    };
  }

  // Theoretical authorize path — still does NOT invoke HttpGithubIssues in C3-B.4.1
  if (!mayMutateIssuesFromArtifact(validated.artifact)) {
    return {
      accepted: false,
      code: 'artifact_forbids_mutation',
      write_gate: gate,
      artifact: validated.artifact,
      planned_op: 'noop',
    };
  }

  return {
    accepted: false,
    code: 'c3_b41_delivery_inert',
    write_gate: gate,
    artifact: validated.artifact,
    planned_op: 'noop',
  };
}

export function deliveryFromValidatedArtifact(
  validated: ArtifactValidationResult,
  opts: { env?: WriteGateEnv; provenance: ProvenanceContext },
): DeliveryAttemptResult {
  if (!validated.ok) {
    return {
      accepted: false,
      code: validated.code,
      write_gate: { authorized: false, code: validated.code, mode: 'blocked' },
    };
  }
  return attemptDeliveryFromJson(validated.canonical_json, {
    env: opts.env,
    provenance: opts.provenance,
  });
}

export const DELIVERY_REAL_ADAPTER_WIRED = false as const;
export const DELIVERY_HTTP_ENABLED = false as const;
