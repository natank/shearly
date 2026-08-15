import pg from 'pg';
import { ValidationError } from '@shearly/shared-errors';
import {
  computeSlots,
  occupancyConflicts,
  type Exception,
  type Occupancy,
  type WeeklyRule,
} from '@shearly/domain-slot-computation';

export class AvailabilityService {
  constructor(
    private readonly pool: pg.Pool,
    private readonly discoveryWindowDays = 30,
    private readonly bufferMinutes = 15,
  ) {}

  async replaceWeekly(accountId: string, rules: WeeklyRule[]): Promise<void> {
    await this.pool.query('DELETE FROM availability.weekly_rules WHERE account_id = $1', [
      accountId,
    ]);
    for (const rule of rules) {
      await this.pool.query(
        `INSERT INTO availability.weekly_rules (account_id, weekday, start_minute, end_minute)
         VALUES ($1, $2, $3, $4)`,
        [accountId, rule.weekday, rule.startMinute, rule.endMinute],
      );
    }
  }

  async addException(
    accountId: string,
    exception: Exception,
    occupancy: Occupancy[] = [],
  ): Promise<void> {
    if (exception.kind === 'block') {
      const conflicts = occupancyConflicts(occupancy, exception.date);
      if (conflicts.length) {
        throw new ValidationError(
          `availability.conflicts:${conflicts.map((item) => item.id ?? 'fixture').join(',')}`,
        );
      }
    }
    await this.pool.query(
      `INSERT INTO availability.exceptions (account_id, on_date, kind, start_minute, end_minute)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        accountId,
        exception.date,
        exception.kind,
        exception.startMinute ?? null,
        exception.endMinute ?? null,
      ],
    );
  }

  async listWeekly(accountId: string): Promise<WeeklyRule[]> {
    const result = await this.pool.query<{
      weekday: number;
      start_minute: number;
      end_minute: number;
    }>(
      `SELECT weekday, start_minute, end_minute FROM availability.weekly_rules
       WHERE account_id = $1 ORDER BY weekday, start_minute`,
      [accountId],
    );
    return result.rows.map((row) => ({
      weekday: row.weekday,
      startMinute: row.start_minute,
      endMinute: row.end_minute,
    }));
  }

  async listExceptions(accountId: string): Promise<Exception[]> {
    const result = await this.pool.query<{
      on_date: string;
      kind: 'block' | 'extra';
      start_minute: number | null;
      end_minute: number | null;
    }>(
      `SELECT on_date::text, kind, start_minute, end_minute FROM availability.exceptions
       WHERE account_id = $1 ORDER BY on_date`,
      [accountId],
    );
    return result.rows.map((row) => ({
      date: row.on_date,
      kind: row.kind,
      startMinute: row.start_minute ?? undefined,
      endMinute: row.end_minute ?? undefined,
    }));
  }

  async slots(
    accountId: string,
    input: {
      durationMinutes: number;
      from: Date;
      to: Date;
      occupancy?: Occupancy[];
      origin?: { lat: number; lng: number };
      now?: Date;
    },
  ) {
    const weekly = await this.listWeekly(accountId);
    const exceptions = await this.listExceptions(accountId);
    return computeSlots({
      weekly,
      exceptions,
      durationMinutes: input.durationMinutes,
      bufferMinutes: this.bufferMinutes,
      occupancy: input.occupancy ?? [],
      origin: input.origin,
      from: input.from,
      to: input.to,
      now: input.now ?? new Date(),
    });
  }

  async hasAvailability(accountId: string): Promise<boolean> {
    const weekly = await this.listWeekly(accountId);
    return weekly.length > 0;
  }

  discoveryDays(): number {
    return this.discoveryWindowDays;
  }
}
