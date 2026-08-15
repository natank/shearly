export const SLOT_COMPUTATION_NAME = 'slot-computation';

export type WeeklyRule = { weekday: number; startMinute: number; endMinute: number };
export type Exception = {
  date: string;
  kind: 'block' | 'extra';
  startMinute?: number;
  endMinute?: number;
};
export type Occupancy = { id?: string; start: Date; end: Date; lat?: number; lng?: number };
export type GeoPoint = { lat: number; lng: number };
export type Slot = { start: Date; end: Date };

export type ComputeSlotsInput = {
  weekly: WeeklyRule[];
  exceptions: Exception[];
  durationMinutes: number;
  bufferMinutes: number;
  occupancy: Occupancy[];
  origin?: GeoPoint;
  from: Date;
  to: Date;
  now: Date;
};

export function haversineKm(a: GeoPoint, b: GeoPoint): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
}

export function distanceBandMinutes(km: number): number {
  if (km <= 5) {
    return 0;
  }
  if (km <= 10) {
    return 15;
  }
  return 30;
}

function startOfDayUtc(value: Date): Date {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
}

function addMinutes(value: Date, minutes: number): Date {
  return new Date(value.getTime() + minutes * 60_000);
}

function ymd(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function windowsForDay(day: Date, weekly: WeeklyRule[], exceptions: Exception[]) {
  const key = ymd(day);
  const blocked = exceptions.some((item) => item.date === key && item.kind === 'block');
  if (blocked) {
    return [];
  }
  const extras = exceptions.filter((item) => item.date === key && item.kind === 'extra');
  if (extras.length) {
    return extras
      .filter((item) => item.startMinute !== undefined && item.endMinute !== undefined)
      .map((item) => ({ startMinute: item.startMinute ?? 0, endMinute: item.endMinute ?? 0 }));
  }
  return weekly
    .filter((rule) => rule.weekday === day.getUTCDay())
    .map((rule) => ({ startMinute: rule.startMinute, endMinute: rule.endMinute }));
}

function blockedRange(occ: Occupancy, bufferMinutes: number, origin?: GeoPoint) {
  let extra = 0;
  if (origin && occ.lat !== undefined && occ.lng !== undefined) {
    extra = distanceBandMinutes(haversineKm(origin, { lat: occ.lat, lng: occ.lng }));
  }
  const pad = bufferMinutes + extra;
  return { start: addMinutes(occ.start, -pad), end: addMinutes(occ.end, pad) };
}

function overlaps(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date): boolean {
  return aStart < bEnd && aEnd > bStart;
}

export function computeSlots(input: ComputeSlotsInput): Slot[] {
  const slots: Slot[] = [];
  const cursor = startOfDayUtc(input.from);
  const last = startOfDayUtc(input.to);
  while (cursor <= last) {
    for (const window of windowsForDay(cursor, input.weekly, input.exceptions)) {
      for (
        let minute = window.startMinute;
        minute + input.durationMinutes <= window.endMinute;
        minute += input.durationMinutes
      ) {
        const start = addMinutes(cursor, minute);
        const end = addMinutes(start, input.durationMinutes);
        if (start < input.now) {
          continue;
        }
        const taken = input.occupancy.some((occ) => {
          const range = blockedRange(occ, input.bufferMinutes, input.origin);
          return overlaps(start, end, range.start, range.end);
        });
        if (!taken) {
          slots.push({ start, end });
        }
      }
    }
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return slots;
}

export function occupancyConflicts(occupancy: Occupancy[], day: string): Occupancy[] {
  return occupancy.filter((item) => ymd(item.start) === day);
}
