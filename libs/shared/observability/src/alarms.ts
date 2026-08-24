/**
 * OBS-004 / design §10.3: the five named alarms (payment capture failure,
 * refund failure, booking expiry spike, orphan-authorization reconciler
 * action, SES bounce rate), MVP-local equivalent — log-based, consistent
 * with the "no paid dependency" pattern M2/M3 used for the geocoder stub.
 * Real CloudWatch/SNS wiring is an extraction-time concern (design's own
 * "not now" framing for anything beyond `desiredCount = 1`).
 *
 * Each alarm is a single structured, greppable log line: `ALARM:<name>
 * <json>` to stderr. The `ALARM:<name>` prefix is deliberately what a
 * CloudWatch metric filter would key off at extraction time — this module
 * is the seam that gets swapped for a real one, not a permanent shape.
 */
export type AlarmName =
  | 'paymentCaptureFailure'
  | 'refundFailure'
  | 'bookingExpirySpike'
  | 'orphanAuthorizationReconcilerAction'
  | 'sesBounceRate';

export function fireAlarm(name: AlarmName, context: Record<string, unknown>): void {
  process.stderr.write(
    `ALARM:${name} ${JSON.stringify({ ...context, at: new Date().toISOString() })}\n`,
  );
}

/**
 * Booking expiry spike is the one alarm that is a rate, not a single
 * event — firing on every individual expiry would be noise (expiries are
 * an expected, routine outcome; a *spike* in them is the actual signal).
 * Tracks a simple in-memory sliding window per process; MVP-local, same
 * "no paid dependency" reasoning as the rest of this module — a real
 * CloudWatch metric alarm would own this windowing at extraction time.
 */
export function createExpirySpikeDetector(windowMs: number, threshold: number) {
  const timestamps: number[] = [];
  return {
    record(now: number = Date.now()): boolean {
      timestamps.push(now);
      while (timestamps.length > 0 && (timestamps[0] ?? 0) < now - windowMs) {
        timestamps.shift();
      }
      return timestamps.length >= threshold;
    },
  };
}
