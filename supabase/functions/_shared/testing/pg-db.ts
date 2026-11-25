/**
 * Minimal Postgres-backed stand-in for the PostgREST query builder subset used by OAuth helpers.
 * Uses real DELETE/UPDATE … RETURNING so concurrency matches production semantics.
 */
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import pg from 'pg';

type Filter =
  | { kind: 'eq'; col: string; value: unknown }
  | { kind: 'lt'; col: string; value: string }
  | { kind: 'is'; col: string; value: null };

export type PgHarness = {
  pool: pg.Pool;
  db: SupabaseClient;
  resetOAuthTables: () => Promise<void>;
  end: () => Promise<void>;
};

function quoteIdent(col: string): string {
  if (!/^[a-z_][a-z0-9_]*$/i.test(col)) throw new Error(`unsafe column: ${col}`);
  return `"${col}"`;
}

export function createPgDb(connectionString: string): PgHarness {
  const pool = new pg.Pool({ connectionString, max: 10 });

  function from(table: string) {
    if (!/^[a-z_][a-z0-9_]*$/i.test(table)) throw new Error(`unsafe table: ${table}`);
    const filters: Filter[] = [];
    let mode: 'select' | 'insert' | 'update' | 'delete' = 'select';
    let payload: Record<string, unknown> | Record<string, unknown>[] | null = null;

    const whereSql = (startIdx = 1): { sql: string; values: unknown[] } => {
      const values: unknown[] = [];
      const parts: string[] = [];
      let i = startIdx;
      for (const f of filters) {
        if (f.kind === 'eq') {
          parts.push(`${quoteIdent(f.col)} = $${i++}`);
          values.push(f.value);
        } else if (f.kind === 'lt') {
          parts.push(`${quoteIdent(f.col)} < $${i++}`);
          values.push(f.value);
        } else if (f.kind === 'is') {
          parts.push(`${quoteIdent(f.col)} IS NULL`);
        }
      }
      return { sql: parts.length ? `WHERE ${parts.join(' AND ')}` : '', values };
    };

    const run = async (): Promise<{ data: Record<string, unknown>[] | null; error: { message: string } | null }> => {
      try {
        if (mode === 'insert') {
          const rows = Array.isArray(payload) ? payload : [payload!];
          const out: Record<string, unknown>[] = [];
          for (const row of rows) {
            const cols = Object.keys(row);
            const vals = cols.map((c) => row[c]);
            const placeholders = cols.map((_, idx) => `$${idx + 1}`);
            const q = `INSERT INTO ${quoteIdent(table)} (${cols.map(quoteIdent).join(',')})
                       VALUES (${placeholders.join(',')}) RETURNING *`;
            const res = await pool.query(q, vals);
            out.push(res.rows[0] as Record<string, unknown>);
          }
          return { data: out, error: null };
        }

        if (mode === 'update') {
          const patch = payload as Record<string, unknown>;
          const cols = Object.keys(patch);
          const setParts = cols.map((c, idx) => `${quoteIdent(c)} = $${idx + 1}`);
          const setVals = cols.map((c) => patch[c]);
          const w = whereSql(setVals.length + 1);
          const q = `UPDATE ${quoteIdent(table)} SET ${setParts.join(', ')} ${w.sql} RETURNING *`;
          const res = await pool.query(q, [...setVals, ...w.values]);
          return { data: res.rows as Record<string, unknown>[], error: null };
        }

        if (mode === 'delete') {
          const w = whereSql(1);
          const q = `DELETE FROM ${quoteIdent(table)} ${w.sql} RETURNING *`;
          const res = await pool.query(q, w.values);
          return { data: res.rows as Record<string, unknown>[], error: null };
        }

        const w = whereSql(1);
        const q = `SELECT * FROM ${quoteIdent(table)} ${w.sql}`;
        const res = await pool.query(q, w.values);
        return { data: res.rows as Record<string, unknown>[], error: null };
      } catch (err) {
        return { data: null, error: { message: err instanceof Error ? err.message : 'query_failed' } };
      }
    };

    const builder = {
      select: (_cols?: string) => builder,
      eq(col: string, value: unknown) {
        filters.push({ kind: 'eq', col, value });
        return builder;
      },
      lt(col: string, value: string) {
        filters.push({ kind: 'lt', col, value });
        return builder;
      },
      is(col: string, value: null) {
        filters.push({ kind: 'is', col, value });
        return builder;
      },
      insert(rows: Record<string, unknown> | Record<string, unknown>[]) {
        mode = 'insert';
        payload = rows;
        return builder;
      },
      update(patch: Record<string, unknown>) {
        mode = 'update';
        payload = patch;
        return builder;
      },
      delete() {
        mode = 'delete';
        return builder;
      },
      maybeSingle: async () => {
        const result = await run();
        if (result.error) return { data: null, error: result.error };
        return { data: result.data?.[0] ?? null, error: null };
      },
      single: async () => {
        const result = await run();
        if (result.error) return { data: null, error: result.error };
        const row = result.data?.[0] ?? null;
        return { data: row, error: row ? null : { message: 'not found' } };
      },
      then(resolve: (v: unknown) => void, reject?: (e: unknown) => void) {
        return run().then(resolve, reject);
      },
    };
    return builder;
  }

  return {
    pool,
    db: { from } as unknown as SupabaseClient,
    async resetOAuthTables() {
      await pool.query('TRUNCATE public.oauth_states, public.calendar_connections, public.profiles CASCADE');
    },
    async end() {
      await pool.end();
    },
  };
}

export function localPgUrl(): string | null {
  const url = process.env.OAUTH_LOCAL_DATABASE_URL ?? process.env.DATABASE_URL ?? null;
  if (!url) return null;
  // Fail closed: never point integration harness at remote Supabase hosts.
  if (/supabase\.co|qszggrrjhcwltnmxpxcy|sknpqjodttkpttaytdut/i.test(url)) {
    throw new Error('refusing remote DATABASE_URL for local OAuth harness');
  }
  if (!/localhost|127\.0\.0\.1/i.test(url)) {
    throw new Error('local OAuth harness requires localhost/127.0.0.1 DATABASE_URL');
  }
  return url;
}
