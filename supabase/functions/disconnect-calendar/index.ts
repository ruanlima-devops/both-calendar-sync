import { adminClient, handle, json, userFromRequest } from '../_shared/function.ts';
import { disconnectConnection } from '../_shared/account/disconnect.ts';
import { AccountDeleteBlockedError } from '../_shared/account/oauth-revoke.ts';
import { env } from '../_shared/http.ts';

Deno.serve((req) =>
  handle(req, async () => {
    const { userId } = await userFromRequest(req);
    const { connectionId } = await req.json();
    if (!connectionId || typeof connectionId !== 'string') throw new Error('connection_id_required');
    try {
      return json(await disconnectConnection(adminClient(), userId, connectionId, env('TOKEN_ENCRYPTION_KEY')));
    } catch (err) {
      if (err instanceof AccountDeleteBlockedError) {
        return json({ error: 'DISCONNECT_BLOCKED', code: err.message }, 503);
      }
      throw err;
    }
  }),
);
