import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';

export type Row = Record<string, unknown>;
export type Tables = Record<string, Row[]>;

/** Minimal in-memory stand-in for the PostgREST query builder used by Edge Function helpers. */
export function createFakeDb(initial: Tables = {}) {
  const tables: Tables = structuredClone(initial);

  function from(table: string) {
    const filters: Array<(row: Row) => boolean> = [];
    let mode: 'select' | 'insert' | 'update' | 'delete' = 'select';
    let payload: Row | Row[] | null = null;

    const matching = () => (tables[table] ?? []).filter((row) => filters.every((f) => f(row)));

    const run = (): { data: Row[] | null; error: null } => {
      if (mode === 'insert') {
        const rows = (Array.isArray(payload) ? payload : [payload!]).map((r) => ({ id: crypto.randomUUID(), ...r }));
        tables[table] = [...(tables[table] ?? []), ...rows];
        return { data: rows, error: null };
      }
      if (mode === 'update') {
        const rows = matching();
        for (const row of rows) Object.assign(row, payload);
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
      insert(rows: Row | Row[]) {
        mode = 'insert';
        payload = rows;
        return builder;
      },
      update(patch: Row) {
        mode = 'update';
        payload = patch;
        return builder;
      },
      delete() {
        mode = 'delete';
        return builder;
      },
      maybeSingle: async () => ({ data: run().data?.[0] ?? null, error: null }),
      single: async () => {
        const row = run().data?.[0] ?? null;
        return { data: row, error: row ? null : { message: 'not found' } };
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
