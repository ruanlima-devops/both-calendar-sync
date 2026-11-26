import { handle } from '../_shared/function.ts';
import { handleLegacySyncCalendar } from '../_shared/sync/sync-calendar-legacy.ts';

/**
 * SEC-07: legacy endpoint retired. Deployed surface returns 410 Gone.
 * Gateway: verify_jwt=true (defense in depth; handler itself is fail-closed).
 */
Deno.serve((req) => handle(req, handleLegacySyncCalendar));
