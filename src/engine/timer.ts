/**
 * Rest-timer arithmetic. Pure, clock injected.
 *
 * TIMESTAMP-DELTA, NEVER ACCUMULATION. Remaining time is always recomputed as
 * (start + duration) − now. Nothing counts down by subtracting a tick.
 *
 * This is not a style preference. `setInterval` does not fire while an iOS app
 * is backgrounded or the phone is locked, so an accumulating timer silently
 * stops and under-reports rest by exactly the time you were away — which is
 * most of the rest interval. A timestamp delta is correct no matter how long
 * the process was frozen, and stays correct across a force-quit because the
 * start epoch is persisted.
 */

export const RESUME_STALE_HOURS = 12;

/** Seconds left, clamped at 0. Never negative. */
export function remainingSec(
  startedAt: number,
  durationSec: number,
  now: number,
  adjustmentSec: number,
): number {
  if (!Number.isFinite(startedAt) || !Number.isFinite(now)) return 0;

  const total = (Number.isFinite(durationSec) ? durationSec : 0)
    + (Number.isFinite(adjustmentSec) ? adjustmentSec : 0);
  if (total <= 0) return 0;

  const elapsed = (now - startedAt) / 1000;
  const left = total - elapsed;

  // Clamp and round toward the displayed second so 0:01 does not linger.
  return left <= 0 ? 0 : Math.ceil(left);
}

/** Fraction of the interval already elapsed, 0–1. Drives the depleting bar. */
export function elapsedFraction(
  startedAt: number,
  durationSec: number,
  now: number,
  adjustmentSec: number,
): number {
  const total = durationSec + adjustmentSec;
  if (!(total > 0)) return 1;
  const elapsed = (now - startedAt) / 1000;
  return Math.min(1, Math.max(0, elapsed / total));
}

/** `M:SS`. Minutes are not zero-padded; seconds always are. */
export function formatMMSS(totalSec: number): string {
  const s = Math.max(0, Math.floor(totalSec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function isComplete(
  startedAt: number,
  durationSec: number,
  now: number,
  adjustmentSec: number,
): boolean {
  return remainingSec(startedAt, durationSec, now, adjustmentSec) === 0;
}

/**
 * Clamp an adjustment so the interval can never be pushed below zero total.
 * `−30s` on a 20-second rest lands at 0, not at −10.
 */
export function applyAdjustment(
  durationSec: number,
  adjustmentSec: number,
  deltaSec: number,
): number {
  const next = adjustmentSec + deltaSec;
  return Math.max(-durationSec, next);
}

/* ---------------- resume classification ---------------- */

export type ResumeAge = 'fresh' | 'stale';

/**
 * How old an unfinished session is.
 *
 * Under 12 hours it is almost certainly the session you are still in, so the
 * sheet offers RESUME or DISCARD. At 12 hours or more it is likely abandoned,
 * and MARK COMPLETE becomes an option — that path deliberately keeps whatever
 * was logged and lets the ledger judge it, which may correctly mean it does
 * not count as a TD1.
 */
export function classifyResume(startedAt: number, now: number): ResumeAge {
  const hours = (now - startedAt) / 3_600_000;
  return hours < RESUME_STALE_HOURS ? 'fresh' : 'stale';
}

export function hoursSince(startedAt: number, now: number): number {
  return (now - startedAt) / 3_600_000;
}
