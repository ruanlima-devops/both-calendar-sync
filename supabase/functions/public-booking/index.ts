import { adminClient, handle, json } from '../_shared/function.ts';
import { clientIp, hitRateLimit } from '../_shared/availability/rate-limit.ts';
import { createBooking, getPublicPage } from '../_shared/availability/booking.ts';
import { track } from '../_shared/sync/runtime.ts';

Deno.serve((req) =>
  handle(req, async () => {
    const db = adminClient();
    const ip = clientIp(req);
    const method = req.method.toUpperCase();
    const url = new URL(req.url);

    if (method === 'GET') {
      const username = (url.searchParams.get('username') ?? '').trim().toLowerCase();
      const slug = (url.searchParams.get('slug') ?? '').trim().toLowerCase();
      const day = url.searchParams.get('day') ?? undefined;
      if (!username || !slug) throw new Error('username_slug_required');

      const ok = await hitRateLimit(db, `pub:avail:${ip}`, 60, 60);
      if (!ok) throw new Error('RATE_LIMITED');

      const page = await getPublicPage(db, username, slug, day);
      return json(page);
    }

    if (method === 'POST') {
      const ok = await hitRateLimit(db, `pub:book:${ip}`, 20, 60);
      if (!ok) throw new Error('RATE_LIMITED');

      const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
      const username = String(body.username ?? '').trim().toLowerCase();
      const slug = String(body.slug ?? '').trim().toLowerCase();
      const startAt = String(body.startAt ?? '');
      const guestName = String(body.guestName ?? '');
      const guestEmail = String(body.guestEmail ?? '');

      if (!username || !slug || !startAt) throw new Error('invalid_request');

      await track(db, null, 'booking_started');

      try {
        const result = await createBooking(db, {
          username,
          slug,
          startAt,
          guestName,
          guestEmail,
          guestNotes: typeof body.guestNotes === 'string' ? body.guestNotes : undefined,
          guestTimezone: typeof body.guestTimezone === 'string' ? body.guestTimezone : undefined,
        });
        return json({ ok: true, ...result });
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

    return json({ error: 'method_not_allowed' }, 405);
  }),
);
