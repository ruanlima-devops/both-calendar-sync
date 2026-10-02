import { adminClient, handle, json, userFromRequest } from '../_shared/function.ts';
import { AccountDeleteBlockedError } from '../_shared/account/oauth-revoke.ts';
import { deleteUserAccount } from '../_shared/account/delete-user.ts';
import { env } from '../_shared/http.ts';

Deno.serve((req) =>
  handle(req, async () => {
    if (req.method !== 'POST') return json({ error: 'METHOD_NOT_ALLOWED' }, 405);
    const { userId } = await userFromRequest(req);
    const db = adminClient();
    try {
      const result = await deleteUserAccount(db, userId, env('TOKEN_ENCRYPTION_KEY'));
      return json({ ok: true, connectionsCleaned: result.connectionsCleaned });
    } catch (err) {
      if (err instanceof AccountDeleteBlockedError) {
        return json({ error: 'ACCOUNT_DELETE_BLOCKED', code: err.message }, 503);
      }
      throw err;
    }
  }),
);
