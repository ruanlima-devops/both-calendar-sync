import { adminClient, handle, json } from '../_shared/function.ts';
import { clientIp, hitRateLimit } from '../_shared/availability/rate-limit.ts';
import {
  cancelBooking,
  rescheduleBooking,
  slotsForManage,
} from '../_shared/availability/booking.ts';

Deno.serve((req) =>
  handle(req, async () => {
    const db = adminClient();
    const ip = clientIp(req);
    const ok = await hitRateLimit(db, `pub:manage:${ip}`, 40, 60);
    if (!ok) throw new Error('RATE_LIMITED');

    const method = req.method.toUpperCase();
    const url = new URL(req.url);

    if (method === 'GET') {
      const token = (url.searchParams.get('token') ?? '').trim();
      const day = url.searchParams.get('day') ?? undefined;
      if (!token) throw new Error('token_required');
      return json(await slotsForManage(db, token, day));
    }

    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const token = String(body.token ?? '').trim();
    const action = String(body.action ?? '').toLowerCase();
    if (!token) throw new Error('token_required');

    if (action === 'cancel' || method === 'DELETE') {
      return json(await cancelBooking(db, token));
    }

    if (action === 'reschedule') {
      const startAt = String(body.startAt ?? '');
      if (!startAt) throw new Error('start_required');
      try {
        return json({ ok: true, ...(await rescheduleBooking(db, token, startAt)) });
      } catch (err) {
        const message = String(err).replace(/^Error:\s*/, '');
        if (message === 'SLOT_UNAVAILABLE') {
          return json(
            {
              error: 'SLOT_UNAVAILABLE',
              message: 'Este horário acabou de ficar indisponível. Escolha outro horário.',
            },
            409,
          );
        }
        throw err;
      }
    }

    throw new Error('invalid_action');
  }),
);
