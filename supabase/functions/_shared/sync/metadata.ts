import { UNIFY_PROP_GROUP, UNIFY_PROP_ROLE } from './types.ts';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type OptionalUuidResult =
  | { kind: 'absent' }
  | { kind: 'valid'; value: string }
  | { kind: 'invalid'; value: string };

/**
 * Normalize optional sync-group metadata that may be persisted as UUID.
 * empty/whitespace/null/undefined → absent
 * valid UUID → valid
 * non-empty non-UUID → invalid (do not coerce to null silently for callers that care)
 */
export function normalizeOptionalUuid(value: string | null | undefined): OptionalUuidResult {
  if (value == null) return { kind: 'absent' };
  const trimmed = value.trim();
  if (!trimmed) return { kind: 'absent' };
  if (UUID_RE.test(trimmed)) return { kind: 'valid', value: trimmed };
  return { kind: 'invalid', value: trimmed };
}

/** Producer/parser: only emit a string when metadata is a real UUID. */
export function optionalUuidOrUndefined(value: string | null | undefined): string | undefined {
  const result = normalizeOptionalUuid(value);
  return result.kind === 'valid' ? result.value : undefined;
}

/**
 * Consumer/persistence: absent or invalid metadata → null (skip UUID column write).
 * Invalid non-empty values are skipped so Postgres never receives "" / garbage as uuid.
 */
export function optionalUuidOrNull(value: string | null | undefined): string | null {
  const result = normalizeOptionalUuid(value);
  return result.kind === 'valid' ? result.value : null;
}

/** Google private extended properties — omit unifySyncGroupId when absent/invalid. */
export function buildUnifyPrivateProps(input: {
  syncGroupId?: string | null;
  role: string;
}): Record<string, string> {
  const props: Record<string, string> = {
    [UNIFY_PROP_ROLE]: input.role,
  };
  const group = optionalUuidOrUndefined(input.syncGroupId);
  if (group) props[UNIFY_PROP_GROUP] = group;
  return props;
}
