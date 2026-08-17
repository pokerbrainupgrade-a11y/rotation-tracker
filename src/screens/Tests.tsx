import { useCallback, useEffect, useMemo, useState } from 'preact/hooks';
import { Skeleton } from '../components/Skeleton';
import { DetailChart, Sparkline } from '../components/Chart';
import { LogResultSheet, type LoggedResult } from './tests/LogResultSheet';
import {
  FULL_CALENDAR_DAY_THRESHOLD,
  FULL_MARKER_ID,
  FULL_TRAINING_DAY_THRESHOLD,
  MINI_MARKER_ID,
  MINI_TRAINING_DAY_THRESHOLD,
  batteryCadence,
  computeDelta,
  deltaColorVar,
  deltaLabel,
  isMarker,
  progressionGate,
  ratioColorVar,
  ratioSeries,
  regressionFlags,
  seriesFor,
} from '../engine/battery';
import {
  listScheduled,
  listTestDefs,
  listTestResults,
  putTestResult,
} from '../data/repo';
import type { ScheduledSession, TestDef, TestResult } from '../types';

let seq = 0;
const newId = (): string => `test-${Date.now().toString(36)}-${++seq}`;

export function Tests() {
  const now = useMemo(() => new Date(), []);
  const [defs, setDefs] = useState<TestDef[]>([]);
  const [results, setResults] = useState<TestResult[]>([]);
  const [sessions, setSessions] = useState<ScheduledSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [logging, setLogging] = useState<TestDef | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [runQueue, setRunQueue] = useState<TestDef[] | null>(null);
  const [exporting, setExporting] = useState(false);

  const load = useCallback(async () => {
    const [d, r, s] = await Promise.all([
      listTestDefs(), listTestResults(), listScheduled(),
    ]);
    setDefs(d);
    setResults(r);
    setSessions(s);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const visible = useMemo(() => defs.filter((d) => !isMarker(d.id)), [defs]);
  const cadence = useMemo(
    () => batteryCadence(results, sessions, now),
    [results, sessions, now],
  );
  const gate = useMemo(() => progressionGate(visible, results), [visible, results]);
  const flags = useMemo(() => regressionFlags(visible, results), [visible, results]);

  const saveResult = useCallback(
    async (def: TestDef, payload: LoggedResult) => {
      const base = {
        localDate: payload.localDate,
        testId: def.id,
        unit: def.unit,
        battery: payload.battery,
        note: payload.note,
        ts: Date.now(),
      };

      if (def.bilateral && payload.left !== undefined && payload.right !== undefined) {
        // Two records, one per side — never one averaged number.
        await putTestResult({ ...base, id: newId(), side: 'L', value: payload.left });
        await putTestResult({ ...base, id: newId(), side: 'R', value: payload.right });
      } else {
        await putTestResult({
          ...base,
          id: newId(),
          side: null,
          value: payload.passed !== undefined ? (payload.passed ? 1 : 0) : (payload.value ?? 0),
        });
      }
      await load();
      setLogging(null);

      // Advance a full-battery run, and write the completion marker only when
      // the whole run finishes.
      setRunQueue((queue) => {
        if (!queue) return null;
        const rest = queue.slice(1);
        if (rest.length > 0) return rest;
        void completeRun(payload.battery);
        return null;
      });
    },
    [load],
  );

  const completeRun = useCallback(
    async (battery: 'full' | 'mini') => {
      // The marker is what resets the counters. Individually logged tests never
      // write it, which is why logging one test does not reset the cadence.
      await putTestResult({
        id: newId(),
        localDate: new Date().toISOString().slice(0, 10),
        testId: battery === 'full' ? FULL_MARKER_ID : MINI_MARKER_ID,
        side: null,
        value: 1,
        unit: 'marker',
        battery,
        note: null,
        ts: Date.now(),
      });
      await load();
    },
    [load],
  );

  const startFullBattery = useCallback(() => {
    const queue = visible.filter((d) => d.battery === 'full' || d.battery === 'both');
    if (queue.length === 0) return;
    setRunQueue(queue);
    setLogging(queue[0] ?? null);
  }, [visible]);

  const skipCurrent = useCallback(() => {
    setRunQueue((queue) => {
      if (!queue) return null;
      const rest = queue.slice(1);
      if (rest.length === 0) {
        void completeRun('full');
        setLogging(null);
        return null;
      }
      setLogging(rest[0] ?? null);
      return rest;
    });
  }, [completeRun]);

  const exportCsv = useCallback(() => {
    setExporting(true);
    void (async () => {
      try {
        const { exportBatteryCsv } = await import('../data/backup');
        const csv = await exportBatteryCsv();
        const blob = new Blob([csv], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `rotation-tracker-battery-${new Date().toISOString().slice(0, 10)}.csv`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
      } finally {
        setExporting(false);
      }
    })();
  }, []);

  if (loading) return <Skeleton />;

  const trainingLeads = cadence.leadingFull === 'training';
  const calLabel = cadence.calendarDaysSinceFull < 0 ? '—' : cadence.calendarDaysSinceFull;

  const renderRow = (def: TestDef): preact.JSX.Element => {
    const series = seriesFor(results, def.id);
    const latest = series[series.length - 1];
    const previous = series[series.length - 2];
    const delta =
      latest && previous && def.kind === 'numeric'
        ? computeDelta(latest.value, previous.value, def.higherIsBetter)
        : null;
    const ratios = def.bilateral ? ratioSeries(results, def.id) : [];
    const latestRatio = ratios[ratios.length - 1];
    const isOpen = open === def.id;

    return (
      <div
        key={def.id}
        class="testrow"
        data-testid="test-row"
        data-test-id={def.id}
        data-grouped={def.group ? 'true' : undefined}
      >
        <button
          type="button"
          class="testrow__head"
          aria-expanded={isOpen}
          onClick={() => setOpen(isOpen ? null : def.id)}
        >
          <span class="testrow__name">{def.name}</span>
          <span class="testrow__right">
            {latest ? (
              <span class="testrow__value num" data-testid="test-value">
                {def.kind === 'passfail'
                  ? latest.value === 1 ? 'PASS' : 'FAIL'
                  : `${latest.value} ${def.unit}`}
              </span>
            ) : (
              <span class="testrow__none">NO RESULTS</span>
            )}
            {delta && (
              <span
                class="testrow__delta num"
                data-testid="test-delta"
                data-direction={delta.direction}
                style={{ color: `var(${deltaColorVar(delta.direction)})` }}
              >
                {deltaLabel(delta)}
              </span>
            )}
            {def.kind === 'numeric' && (
              <Sparkline series={series} color="var(--velocity)" />
            )}
          </span>
        </button>

        {latestRatio && (
          <p
            class="testrow__ratio num"
            data-testid="test-ratio"
            style={{ color: `var(${ratioColorVar(latestRatio.value)})` }}
          >
            L/R Δ {latestRatio.value}%
          </p>
        )}

        {isOpen && (
          <div class="testrow__detail">
            {def.kind === 'numeric' ? (
              <DetailChart series={series} color="var(--velocity)" unit={def.unit} />
            ) : (
              <p class="chart__empty">Pass/fail — no trend</p>
            )}

            {series.length > 0 && (
              <table class="history num">
                <tbody>
                  {[...series].reverse().slice(0, 10).map((p) => (
                    <tr key={p.localDate}>
                      <td>{p.localDate}</td>
                      <td>
                        {def.kind === 'passfail'
                          ? p.value === 1 ? 'PASS' : 'FAIL'
                          : `${p.value} ${def.unit}`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            <button
              type="button"
              class="btn btn--primary testrow__log"
              data-testid="log-result"
              onClick={() => setLogging(def)}
            >
              + LOG RESULT
            </button>
          </div>
        )}
      </div>
    );
  };

  return (
    <main class="screen tests" data-testid="tests">
      {/* --- cadence header, always visible --- */}
      <div class="cadence" data-testid="cadence">
        <div class="cadence__row" data-leading={trainingLeads ? 'true' : undefined}>
          <span class="cadence__label">TRAINING DAYS SINCE FULL BATTERY</span>
          <span
            class="cadence__value num"
            data-testid="cadence-training"
            data-due={cadence.trainingDaysSinceFull >= FULL_TRAINING_DAY_THRESHOLD ? 'true' : undefined}
          >
            {cadence.trainingDaysSinceFull} / {FULL_TRAINING_DAY_THRESHOLD}
          </span>
        </div>
        <div class="cadence__row" data-leading={!trainingLeads ? 'true' : undefined}>
          <span class="cadence__label">DAYS SINCE FULL BATTERY</span>
          <span
            class="cadence__value num"
            data-testid="cadence-calendar"
            data-due={
              cadence.calendarDaysSinceFull < 0 ||
              cadence.calendarDaysSinceFull >= FULL_CALENDAR_DAY_THRESHOLD
                ? 'true'
                : undefined
            }
          >
            {calLabel} / {FULL_CALENDAR_DAY_THRESHOLD}
          </span>
        </div>
        <div class="cadence__row">
          <span class="cadence__label">MINI BATTERY</span>
          <span
            class="cadence__value num"
            data-testid="cadence-mini"
            data-due={cadence.miniDue ? 'true' : undefined}
          >
            {cadence.trainingDaysSinceMini} / {MINI_TRAINING_DAY_THRESHOLD} training days
          </span>
        </div>
      </div>

      {/* --- gate and flags: display only --- */}
      <p class="gate" data-testid="progression-gate" data-status={gate.status}>
        {gate.label}
      </p>
      {flags.map((f) => (
        <p key={f.testId} class="gate gate--regression" data-testid="regression-flag">
          {f.label}
        </p>
      ))}

      <div class="tests__actions">
        <button
          type="button"
          class="btn btn--primary"
          data-testid="log-full-battery"
          onClick={startFullBattery}
        >
          LOG FULL BATTERY
        </button>
        <button
          type="button"
          class="btn btn--secondary"
          data-testid="export-battery"
          disabled={exporting}
          onClick={exportCsv}
        >
          {exporting ? 'EXPORTING…' : 'EXPORT BATTERY (CSV)'}
        </button>
      </div>

      <section class="section">
        <div class="section__head"><h2 class="section__title">Full Battery</h2></div>
        {visible.filter((d) => d.battery === 'full' || d.battery === 'both').map(renderRow)}
      </section>

      <section class="section">
        <div class="section__head"><h2 class="section__title">Mini Battery</h2></div>
        {visible.filter((d) => d.battery === 'mini' || d.battery === 'both').map(renderRow)}
      </section>

      {logging && (
        <>
          <LogResultSheet
            def={logging}
            onClose={() => {
              setLogging(null);
              setRunQueue(null);
            }}
            onSave={(payload) => saveResult(logging, payload)}
          />
          {runQueue && (
            <button
              type="button"
              class="run__skip"
              data-testid="battery-skip"
              onClick={skipCurrent}
            >
              SKIP THIS TEST ({runQueue.length} LEFT)
            </button>
          )}
        </>
      )}
    </main>
  );
}
