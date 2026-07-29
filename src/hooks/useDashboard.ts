import { useCallback, useEffect, useState } from 'preact/hooks';
import { toLocalDate } from '../data/dates';
import { ensureBooted } from '../data/boot';
import {
  getProfile,
  listBlocks,
  listScheduled,
  listSessionTemplates,
  listExercises,
  listSetLogs,
  listEsdLogs,
} from '../data/repo';
import { computeLedger, type LedgerRow } from '../engine/ledger';
import { evaluateConstraints, type Warning } from '../engine/constraints';
import { nextPosition, type Density } from '../engine/rotation';
import { exportStatus, type ExportStatusInfo } from '../lib/exportStatus';
import type {
  Block,
  Profile,
  RotationPosition,
  ScheduledSession,
  SessionTemplate,
} from '../types';

export type AppState = 'opening' | 'error' | 'no-profile' | 'ready';

export interface DashboardData {
  profile: Profile;
  block: Block;
  ledger: LedgerRow[];
  warnings: Warning[];
  next: {
    position: RotationPosition;
    template: SessionTemplate | undefined;
    scheduled: ScheduledSession | undefined;
  };
  recent: Array<{ session: ScheduledSession; name: string }>;
  exportInfo: ExportStatusInfo;
  todayLabel: string;
  blockLine: string;
  windowLabel: string;
}

export interface DashboardState {
  state: AppState;
  error: { code: string; message: string } | null;
  data: DashboardData | null;
  reload: () => void;
}

/** Density is program configuration; 3:1 until Settings can change it. */
const DENSITY: Density = '3:1';

/**
 * Loads the Dashboard from the REAL data layer and the REAL engines.
 *
 * Nothing here is stubbed. Half the value of this phase is proving Phase 1 and
 * Phase 2 actually connect — a dashboard fed by fixtures would look identical
 * and prove nothing.
 */
export function useDashboard(now: Date = new Date()): DashboardState {
  const [state, setState] = useState<AppState>('opening');
  const [error, setError] = useState<{ code: string; message: string } | null>(null);
  const [data, setData] = useState<DashboardData | null>(null);
  const [nonce, setNonce] = useState(0);

  const reload = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      const boot = await ensureBooted();
      if (cancelled) return;

      if (!boot.ok) {
        setError(boot.error);
        setState('error');
        return;
      }

      const profile = await getProfile();
      if (cancelled) return;
      if (!profile) {
        setState('no-profile');
        return;
      }

      const [scheduled, setLogs, esdLogs, templates, exercises, blocks] = await Promise.all([
        listScheduled(),
        listSetLogs(),
        listEsdLogs(),
        listSessionTemplates(),
        listExercises(),
        listBlocks(),
      ]);
      if (cancelled) return;

      const block =
        blocks.find((b) => b.id === profile.currentBlockId) ?? blocks[0];
      if (!block) {
        setError({
          code: 'NO_BLOCK',
          message: 'The program defines no training blocks, so nothing can be scheduled.',
        });
        setState('error');
        return;
      }

      const ledger = computeLedger({
        scheduled, setLogs, esdLogs, templates, exercises, block, now,
      });
      const warnings = evaluateConstraints({ schedule: scheduled, ledger, templates, now });

      // Next position comes from the engine, never recomputed here.
      const position = nextPosition(scheduled, DENSITY);
      const template = templates.find((t) => t.position === position);
      const today = toLocalDate(now);
      const upcoming = scheduled
        .filter((s) => s.status === 'planned' && s.localDate >= today)
        .sort((a, b) => (a.localDate < b.localDate ? -1 : 1));
      const nextScheduled = upcoming.find((s) => s.position === position) ?? upcoming[0];

      const templateName = new Map(templates.map((t) => [t.id, t.name]));
      const recent = scheduled
        .filter((s) => s.status === 'done')
        .sort((a, b) => (a.localDate < b.localDate ? 1 : a.localDate > b.localDate ? -1 : b.ts - a.ts))
        .slice(0, 5)
        .map((s) => ({ session: s, name: templateName.get(s.templateId) ?? s.templateId }));

      setData({
        profile,
        block,
        ledger,
        warnings,
        next: { position, template, scheduled: nextScheduled },
        recent,
        exportInfo: exportStatus(profile.lastExport, profile.storagePersisted, now),
        todayLabel: formatToday(now),
        blockLine: `${block.name.toUpperCase()} · R${profile.rotationNumber}`,
        windowLabel: `${shortDate(now, -27)} – ${shortDate(now, 0)}`,
      });
      setState('ready');
    })();

    return () => {
      cancelled = true;
    };
    // `now` is intentionally NOT a dependency: it is a fresh Date on every
    // render, so including it would re-run this effect forever. Reloads are
    // driven explicitly through `nonce`.
  }, [nonce]);

  return { state, error, data, reload };
}

function formatToday(now: Date): string {
  return now
    .toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })
    .toUpperCase();
}

function shortDate(now: Date, offsetDays: number): string {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offsetDays);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }).toUpperCase();
}
