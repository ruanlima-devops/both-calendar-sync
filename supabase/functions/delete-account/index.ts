import { adminClient, handle, json, userFromRequest } from '../_shared/function.ts';
import { deleteUserAccount } from '../_shared/account/delete-user.ts';
import { env } from '../_shared/http.ts';

Deno.serve((req) =>
  handle(req, async () => {
    if (req.method !== 'POST') return json({ error: 'METHOD_NOT_ALLOWED' }, 405);
    // User identity comes only from JWT — ignore any body userId.
    const { userId } = await userFromRequest(req);
    const db = adminClient();
    const result = await deleteUserAccount(db, userId, env('TOKEN_ENCRYPTION_KEY'));
    return json({ ok: true, connectionsCleaned: result.connectionsCleaned });
  }),
);
