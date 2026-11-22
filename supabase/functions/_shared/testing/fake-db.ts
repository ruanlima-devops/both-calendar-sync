import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';

export type Row = Record<string, unknown>;
export type Tables = Record<string, Row[]>;

export type FakeDbOptions = {
  /** Column groups that must be unique within a table (simulates Postgres unique / 23505). */
  unique?: Record<string, string[][]>;
  /** Force SELECT/maybeSingle errors per table (transient DB failures). */
  selectErrors?: Record<string, { message: string; code?: string }>;
};

const DEFAULT_UNIQUE: Record<string, string[][]> = {
  billing_events: [['provider', 'provider_event_id']],
};

/** Minimal in-memory stand-in for the PostgREST query builder used by Edge Function helpers. */
export function createFakeDb(initial: Tables = {}, options: FakeDbOptions = {}) {
  const tables: Tables = structuredClone(initial);
  const unique = { ...DEFAULT_UNIQUE, ...(options.unique ?? {}) };
  const selectErrors = options.selectErrors ?? {};

  function from(table: string) {
    const filters: Array<(row: Row) => boolean> = [];
    let mode: 'select' | 'insert' | 'update' | 'delete' = 'select';
    let payload: Row | Row[] | null = null;
    let lastError: { code?: string; message: string } | null = null;

    const matching = () => (tables[table] ?? []).filter((row) => filters.every((f) => f(row)));

    const run = (): { data: Row[] | null; error: { code?: string; message: string } | null } => {
      if (lastError) return { data: null, error: lastError };
      if (mode === 'select' && selectErrors[table]) {
        return { data: null, error: selectErrors[table]! };
      }

      if (mode === 'insert') {
        const rows = (Array.isArray(payload) ? payload : [payload!]).map((r) => ({
          id: crypto.randomUUID(),
          updated_at: new Date().toISOString(),
          ...r,
        }));
        const constraints = unique[table] ?? [];
        for (const row of rows) {
          for (const cols of constraints) {
            const dup = (tables[table] ?? []).some((existing) =>
              cols.every((c) => existing[c] === row[c]),
            );
            if (dup) {
              return { data: null, error: { code: '23505', message: 'duplicate key value' } };
            }
          }
        }
        tables[table] = [...(tables[table] ?? []), ...rows];
        return { data: rows, error: null };
      }
      if (mode === 'update') {
        const rows = matching();
        for (const row of rows) {
          Object.assign(row, payload);
          if (!('updated_at' in (payload as Row))) {
            row.updated_at = new Date().toISOString();
          }
        }
        return { data: rows, error: null };
      }
      if (mode === 'delete') {
        const rows = matching();
        tables[table] = (tables[table] ?? []).filter((row) => !rows.includes(row));
        return { data: rows, error: null };
      }
      return { data: matching(), error: null };
    };

    const builder = {
      select: (_cols?: string) => builder,
      eq(col: string, value: unknown) {
        filters.push((row) => row[col] === value);
        return builder;
      },
      neq(col: string, value: unknown) {
        filters.push((row) => row[col] !== value);
        return builder;
      },
      in(col: string, values: unknown[]) {
        filters.push((row) => values.includes(row[col]));
        return builder;
      },
      lt(col: string, value: string) {
        filters.push((row) => String(row[col]) < value);
        return builder;
      },
      gt(col: string, value: string) {
        filters.push((row) => String(row[col]) > value);
        return builder;
      },
      is(col: string, value: null) {
        filters.push((row) => (row[col] ?? null) === value);
        return builder;
      },
      order(_col?: string, _opts?: unknown) {
        return builder;
      },
      limit(_n?: number) {
        return builder;
      },
      or(_expr?: string) {
        return builder;
      },

      insert(rows: Row | Row[]) {
        mode = 'insert';
        payload = rows;
        lastError = null;
        return builder;
      },
      update(patch: Row) {
        mode = 'update';
        payload = patch;
        lastError = null;
        return builder;
      },
      delete() {
        mode = 'delete';
        lastError = null;
        return builder;
      },
      maybeSingle: async () => {
        const result = run();
        return { data: result.data?.[0] ?? null, error: result.error };
      },
      single: async () => {
        const result = run();
        const row = result.data?.[0] ?? null;
        return {
          data: row,
          error: result.error ?? (row ? null : { message: 'not found' }),
        };
      },
      then(resolve: (v: unknown) => void, reject?: (e: unknown) => void) {
        return Promise.resolve(run()).then(resolve, reject);
      },
    };
    return builder;
  }

  return { db: { from } as unknown as SupabaseClient, tables };
}

export function stubDenoEnv(values: Record<string, string>): void {
  (globalThis as { Deno?: unknown }).Deno = { env: { get: (key: string) => values[key] } };
}
