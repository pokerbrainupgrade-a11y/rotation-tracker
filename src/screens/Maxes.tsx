import { useCallback, useEffect, useState } from 'preact/hooks';
import { NumberStepper } from '../components/NumberStepper';
import { Skeleton } from '../components/Skeleton';
import { deleteMax, getProfile, listLifts, listMaxes, putMax } from '../data/repo';
import { maxAge } from '../engine/loadResolve';
import { toLocalDate } from '../data/dates';
import type { Lift, MaxRecord, Profile } from '../types';

interface MaxesProps {
  /** Lift row to scroll to and open, when routed from a SET MAX link. */
  focusLiftId?: string | null;
  onBack: () => void;
}

/**
 * Editing any value here recomputes every dependent target across the app,
 * because every screen resolves loads from these records at render time rather
 * than caching a computed weight.
 */
export function Maxes({ focusLiftId = null, onBack }: MaxesProps) {
  const [lifts, setLifts] = useState<Lift[]>([]);
  const [maxes, setMaxes] = useState<MaxRecord[]>([]);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [editing, setEditing] = useState<string | null>(focusLiftId);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const [l, m, p] = await Promise.all([listLifts(), listMaxes(), getProfile()]);
    setLifts(l.filter((x) => !x.deprecated));
    setMaxes(m);
    setProfile(p ?? null);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const save = useCallback(
    async (liftId: string, patch: Partial<MaxRecord>) => {
      const existing = maxes.find((m) => m.liftId === liftId);
      const next: MaxRecord = {
        liftId,
        e1rm: patch.e1rm ?? existing?.e1rm ?? 0,
        unit: patch.unit ?? existing?.unit ?? profile?.units ?? 'lb',
        testedOn: patch.testedOn ?? existing?.testedOn ?? toLocalDate(new Date()),
        method: patch.method ?? existing?.method ?? 'estimated',
      };
      if (next.e1rm <= 0) await deleteMax(liftId);
      else await putMax(next);
      await load();
    },
    [maxes, profile, load],
  );

  if (loading) return <Skeleton />;

  const now = new Date();

  return (
    <main class="screen maxes" data-testid="maxes">
      <header class="maxes__header">
        <button type="button" class="day__chev" aria-label="Back" onClick={onBack}>
          ‹
        </button>
        <h1 class="maxes__title">Maxes</h1>
      </header>

      {lifts.map((lift) => {
        const record = maxes.find((m) => m.liftId === lift.id);
        const age = record ? maxAge(record, now) : null;
        const open = editing === lift.id;

        return (
          <div
            key={lift.id}
            class="maxrow"
            data-testid="max-row"
            data-lift-id={lift.id}
            data-open={open ? 'true' : undefined}
          >
            <button
              type="button"
              class="maxrow__head"
              aria-expanded={open}
              onClick={() => setEditing(open ? null : lift.id)}
            >
              <span class="maxrow__name">{lift.name}</span>
              <span class="maxrow__right">
                {record ? (
                  <span class="maxrow__value num" data-testid="max-value">
                    {record.e1rm}
                  </span>
                ) : (
                  <span class="maxrow__untested" data-testid="max-untested">NOT TESTED</span>
                )}
              </span>
            </button>

            {record && (
              <div class="maxrow__meta">
                <span class="maxrow__method" data-method={record.method}>
                  {record.method.toUpperCase()}
                </span>
                {/*
                  Display only. A stale e1RM biases every computed load in the
                  same direction and nothing corrects it, so stating the age is
                  useful — but it must not prompt or suggest a retest.
                */}
                <span
                  class="maxrow__age num"
                  data-testid="max-age"
                  data-stale={age?.stale ? 'true' : undefined}
                  style={age?.stale ? { color: 'var(--strength)' } : undefined}
                >
                  {age?.label}
                </span>
              </div>
            )}

            {open && (
              <div class="maxrow__edit">
                <NumberStepper
                  label={`${lift.name} e1RM`}
                  value={record?.e1rm ?? 0}
                  step={profile?.units === 'kg' ? 2.5 : 5}
                  suffix={profile?.units ?? 'lb'}
                  onChange={(n) => void save(lift.id, { e1rm: n })}
                />
                <div class="setup__method">
                  {(['tested', 'estimated'] as const).map((m) => (
                    <button
                      key={m}
                      type="button"
                      class="setup__methodbtn"
                      aria-pressed={(record?.method ?? 'estimated') === m}
                      data-testid={`method-${m}`}
                      onClick={() => void save(lift.id, { method: m })}
                    >
                      {m.toUpperCase()}
                    </button>
                  ))}
                </div>
                <label class="field">
                  <span class="field__label">TESTED ON</span>
                  <input
                    class="field__input num"
                    type="date"
                    value={record?.testedOn ?? toLocalDate(now)}
                    onInput={(e) =>
                      void save(lift.id, {
                        testedOn: (e.target as HTMLInputElement).value,
                      })
                    }
                  />
                </label>
              </div>
            )}
          </div>
        );
      })}
    </main>
  );
}
