import { daysBetweenLocal, toLocalDate } from '../data/dates';

/**
 * How stale the last backup is, and how loudly to say so.
 *
 * Thresholds HALVE when storage is not persistent. Best-effort storage can be
 * evicted by the browser without warning, so the same number of days carries
 * more risk and should be surfaced sooner.
 */

export type ExportSeverity = 'ok' | 'stale' | 'critical';

export interface ExportStatusInfo {
  /** Whole local days since the last export; null when never exported. */
  days: number | null;
  severity: ExportSeverity;
  /** Show the once-daily launch modal. */
  nag: boolean;
  label: string;
}

export const STALE_DAYS = 14;
export const CRITICAL_DAYS = 21;

export function exportStatus(
  lastExport: string | null,
  storagePersisted: boolean | null,
  now: Date,
): ExportStatusInfo {
  // Anything other than an explicit `true` is not durable.
  const halve = storagePersisted !== true;
  const stale = halve ? Math.floor(STALE_DAYS / 2) : STALE_DAYS;
  const critical = halve ? Math.floor(CRITICAL_DAYS / 2) : CRITICAL_DAYS;

  if (!lastExport) {
    return {
      days: null,
      severity: 'critical',
      nag: true,
      label: 'LAST EXPORT · NEVER',
    };
  }

  const then = new Date(lastExport);
  if (Number.isNaN(then.getTime())) {
    return { days: null, severity: 'critical', nag: true, label: 'LAST EXPORT · UNKNOWN' };
  }

  const days = Math.max(0, daysBetweenLocal(toLocalDate(then), toLocalDate(now)));

  const severity: ExportSeverity =
    days >= critical ? 'critical' : days >= stale ? 'stale' : 'ok';

  const when =
    days === 0 ? 'TODAY' : days === 1 ? '1 DAY AGO' : `${days} DAYS AGO`;

  return {
    days,
    severity,
    nag: severity === 'critical',
    label: `LAST EXPORT · ${when}`,
  };
}

/** `--text-dim` while fine, `--alert` once stale. Never `--brand`. */
export function exportColorVar(severity: ExportSeverity): string {
  return severity === 'ok' ? '--text-dim' : '--alert';
}
