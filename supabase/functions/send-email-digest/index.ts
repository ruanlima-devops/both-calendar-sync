import { adminClient, cronAuthorized, handle, json } from '../_shared/function.ts';
import { logSafe } from '../_shared/http.ts';
import type { DigestType } from '../_shared/email/digest.ts';
import { processDigests } from '../_shared/email/runner.ts';

function parseTypes(body: Record<string, unknown>): DigestType[] {
  const raw = body.type ?? body.digestType ?? 'both';
  if (raw === 'weekly') return ['weekly'];
  if (raw === 'monthly') return ['monthly'];
  return ['weekly', 'monthly'];
}

Deno.serve((req) =>
  handle(req, async () => {
    const authorized = cronAuthorized(req);
    let body: Record<string, unknown> = {};
    try {
      body = await req.json();
    } catch {
      body = {};
    }

    const userId = typeof body.userId === 'string' ? body.userId : undefined;
    const force = body.force === true;
    const dryRun = body.dryRun === true;

    if (!authorized && !userId) {
      return json({ error: 'UNAUTHENTICATED' }, 401);
    }

    const db = adminClient();
    const result = await processDigests(db, {
      types: parseTypes(body),
      userId,
      force: force || Boolean(userId),
      dryRun,
    });

    logSafe('send_email_digest', result);
    return json({ ok: true, ...result });
  }),
);
