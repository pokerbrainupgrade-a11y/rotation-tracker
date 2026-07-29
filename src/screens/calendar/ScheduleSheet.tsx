import { useMemo, useState } from 'preact/hooks';
import { Sheet } from '../../components/Sheet';
import { WarningReview } from './WarningReview';
import { sessionColor } from '../../lib/sessionColor';
import { metabolicLoad, neuralLoad } from '../../lib/sessionMeta';
import { longDate } from '../../lib/calendarGrid';
import { nextPosition } from '../../engine/rotation';
import { evaluateConstraints, type Warning } from '../../engine/constraints';
import { SEED_VERSION, type Profile, type RotationPosition, type ScheduledSession, type SessionTemplate } from '../../types';

const ALL_POSITIONS: RotationPosition[] = [
  'TD1', 'TD2', 'TD3', 'TD-A', 'TD-B-STR', 'TD-B-ESD', 'RD',
];

interface ScheduleSheetProps {
  localDate: string;
  schedule: ScheduledSession[];
  templates: SessionTemplate[];
  profile: Profile;
  now: Date;
  onClose: () => void;
  onSave: (session: ScheduledSession) => Promise<void>;
}

export function ScheduleSheet({
  localDate, schedule, templates, profile, now, onClose, onSave,
}: ScheduleSheetProps) {
  // The suggestion comes from the engine. No local sequencing logic exists
  // here — a second implementation would drift from the first.
  const suggested = useMemo(() => nextPosition(schedule, '3:1'), [schedule]);

  const [position, setPosition] = useState<RotationPosition>(suggested);
  const [showOverride, setShowOverride] = useState(false);
  const [blockId, setBlockId] = useState(profile.currentBlockId);
  const [rotationNumber, setRotationNumber] = useState(profile.rotationNumber);
  const [pending, setPending] = useState<{ session: ScheduledSession; warnings: Warning[] } | null>(null);
  const [saving, setSaving] = useState(false);

  const templateFor = (p: RotationPosition): SessionTemplate | undefined =>
    templates.find((t) => t.position === p);

  const build = (): ScheduledSession => ({
    id: `sess-${localDate}-${position}-${Date.now().toString(36)}`,
    localDate,
    ts: new Date(`${localDate}T12:00:00`).getTime(),
    templateId: templateFor(position)?.id ?? '',
    position,
    blockId,
    rotationNumber,
    status: 'planned',
    compressionLevel: 100,
    deload: false,
    substituted: false,
    substitutionNote: null,
    metDosingSignature: null,
    startedAt: null,
    completedAt: null,
    seedVersionAtLog: SEED_VERSION,
  });

  const confirm = (): void => {
    const session = build();
    // Evaluate against the PROSPECTIVE schedule, so the warning describes the
    // schedule you would actually have.
    const warnings = evaluateConstraints({
      schedule: [...schedule, session],
      ledger: [],
      templates,
      now,
    }).filter((w) => w.relatedDate === undefined || w.relatedDate >= localDate);

    if (warnings.length === 0) {
      void commit(session);
      return;
    }
    setPending({ session, warnings });
  };

  const commit = async (session: ScheduledSession): Promise<void> => {
    setSaving(true);
    try {
      await onSave(session);
    } finally {
      setSaving(false);
    }
  };

  if (pending) {
    return (
      <WarningReview
        warnings={pending.warnings}
        busy={saving}
        onCancel={() => setPending(null)}
        onProceed={() => void commit(pending.session)}
      />
    );
  }

  const color = sessionColor(position);
  const template = templateFor(position);

  return (
    <Sheet title={`Schedule · ${longDate(localDate)}`} onClose={onClose} testId="schedule-sheet">
      <p class="sheet__label">SUGGESTED</p>

      {/* One tap to accept. This is the default path and reads like one. */}
      <button
        type="button"
        class="suggest"
        data-testid="suggested"
        data-position={suggested}
        aria-pressed={position === suggested}
        onClick={() => setPosition(suggested)}
      >
        <span class="suggest__pos num" style={{ color: sessionColor(suggested) }}>
          {suggested}
        </span>
        <span class="suggest__name">{templateFor(suggested)?.name ?? 'Session'}</span>
      </button>

      <button
        type="button"
        class="sheet__disclosure"
        aria-expanded={showOverride}
        onClick={() => setShowOverride((v) => !v)}
      >
        OVERRIDE {showOverride ? '▲' : '▼'}
      </button>

      {showOverride && (
        <div class="positions" data-testid="override">
          {ALL_POSITIONS.map((p) => (
            <button
              key={p}
              type="button"
              class="positions__btn"
              aria-pressed={p === position}
              data-position={p}
              style={{ color: sessionColor(p) }}
              onClick={() => setPosition(p)}
            >
              {p}
            </button>
          ))}
        </div>
      )}

      <div class="sheet__fields">
        <label class="field">
          <span class="field__label">BLOCK</span>
          <input
            class="field__input"
            value={blockId}
            onInput={(e) => setBlockId((e.target as HTMLInputElement).value)}
          />
        </label>
        <label class="field">
          <span class="field__label">ROTATION</span>
          <input
            class="field__input num"
            type="number"
            min="1"
            value={rotationNumber}
            onInput={(e) =>
              setRotationNumber(Number((e.target as HTMLInputElement).value) || 1)
            }
          />
        </label>
      </div>

      <div class="sheet__summary" style={{ borderLeftColor: color }}>
        <span class="sheet__summary-pos num" style={{ color }}>{position}</span>
        <span class="sheet__summary-name">{template?.name ?? 'Session'}</span>
        <span class="sheet__summary-load num">
          NEURAL {neuralLoad(position)}/10 · METABOLIC {metabolicLoad(position)}/10
        </span>
      </div>

      <button
        type="button"
        class="btn btn--primary sheet__confirm"
        data-testid="schedule-confirm"
        disabled={saving}
        onClick={confirm}
      >
        {saving ? 'SAVING…' : 'CONFIRM'}
      </button>
    </Sheet>
  );
}
