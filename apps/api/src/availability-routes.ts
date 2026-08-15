import { Hono } from 'hono';
import type { AppConfig } from '@shearly/shared-config';
import type { IdentityService } from '@shearly/services-identity';
import type { AvailabilityService } from '@shearly/services-availability';
import { ValidationError } from '@shearly/shared-errors';
import { requireProvider } from './session.js';

export function createAvailabilityRoutes(
  identity: IdentityService,
  availability: AvailabilityService,
  config: AppConfig,
) {
  const routes = new Hono();

  routes.put('/availability/me/weekly', async (c) => {
    const account = await requireProvider(c, identity, config);
    const body = (await c.req.json().catch(() => null)) as {
      rules?: { weekday: number; startMinute: number; endMinute: number }[];
    } | null;
    if (!body?.rules) {
      throw new ValidationError('errors.validation');
    }
    await availability.replaceWeekly(account.id, body.rules);
    return c.json({ ok: true });
  });

  routes.post('/availability/me/exceptions', async (c) => {
    const account = await requireProvider(c, identity, config);
    const body = (await c.req.json().catch(() => null)) as {
      date?: string;
      kind?: 'block' | 'extra';
      startMinute?: number;
      endMinute?: number;
      occupancy?: { id?: string; start: string; end: string }[];
    } | null;
    if (!body?.date || !body.kind) {
      throw new ValidationError('errors.validation');
    }
    await availability.addException(
      account.id,
      {
        date: body.date,
        kind: body.kind,
        startMinute: body.startMinute,
        endMinute: body.endMinute,
      },
      (body.occupancy ?? []).map((item) => ({
        id: item.id,
        start: new Date(item.start),
        end: new Date(item.end),
      })),
    );
    return c.json({ ok: true });
  });

  routes.get('/availability/me/slots', async (c) => {
    const account = await requireProvider(c, identity, config);
    const duration = Number(c.req.query('duration') ?? 60);
    const from = new Date(c.req.query('from') ?? Date.now());
    const to = new Date(c.req.query('to') ?? from);
    const slots = await availability.slots(account.id, { durationMinutes: duration, from, to });
    return c.json({
      slots: slots.map((slot) => ({
        start: slot.start.toISOString(),
        end: slot.end.toISOString(),
      })),
    });
  });

  routes.get('/availability/me/schedule', async (c) => {
    const account = await requireProvider(c, identity, config);
    return c.json({
      weekly: await availability.listWeekly(account.id),
      exceptions: await availability.listExceptions(account.id),
      occupancy: [],
    });
  });

  return routes;
}
