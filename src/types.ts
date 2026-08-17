export const SCHEMA_VERSION = 3;
export const SEED_VERSION = 3;

export type Units = 'lb' | 'kg';
export type Side = 'L' | 'R' | null;

export type RotationPosition =
  | 'TD1' | 'TD2' | 'TD3'
  | 'TD-A' | 'TD-B-STR' | 'TD-B-ESD'
  | 'RD';

export type SessionStatus = 'planned' | 'done' | 'missed' | 'deferred';
export type CompressionLevel = 100 | 75 | 50 | 25;

/* ---------- USER STORES (exported in backups) ---------- */

export interface Profile {
  id: 'me';
  units: Units;
  bodyweight: number | null;
  hrMax: number | null;
  barWeight: number;                 // plate math, in `units`
  plateInventory: number[];          // per-side plates available
  lastExport: string | null;         // ISO datetime
  storagePersisted: boolean | null;  // null = not yet requested
  currentBlockId: string;
  rotationNumber: number;
  wakeLockEnabled: boolean;
  audioCueEnabled: boolean;
  /** Larger numerals, reduced chrome, for reading off a bench. Schema v3. */
  trainingMode: boolean;
  schemaVersion: number;
  seedVersion: number;
}

export interface MaxRecord {
  liftId: string;                    // FK -> lifts
  e1rm: number;
  unit: Units;
  testedOn: string;                  // YYYY-MM-DD local
  method: 'tested' | 'estimated';
}

/**
 * A running rest timer, persisted so a mid-rest app kill restores it.
 * Timestamp-based: `startedAt` plus elapsed wall-clock is the only source of
 * truth. Nothing accumulates.
 */
export interface ActiveTimer {
  startedAt: number;       // epoch ms
  durationSec: number;
  adjustmentSec: number;   // net of +30s / -30s taps
  exerciseId: string;
}

export interface ScheduledSession {
  id: string;                        // uuid
  localDate: string;                 // YYYY-MM-DD local — LEDGER KEY
  ts: number;                        // epoch ms — ordering only
  templateId: string;                // FK -> sessionTemplates
  position: RotationPosition;
  blockId: string;                   // FK -> blocks
  rotationNumber: number;
  status: SessionStatus;
  compressionLevel: CompressionLevel;
  deload: boolean;
  substituted: boolean;
  substitutionNote: string | null;
  metDosingSignature: boolean | null; // null unless substituted
  startedAt: number | null;          // resume support (Phase 5)
  completedAt: number | null;
  seedVersionAtLog: number;          // program definition active at log time
  /** Completed checklist item ids (Pillar Prep, Movement Prep). Schema v2. */
  checklist: string[];
  /** Persisted rest timer, or null. Schema v2. */
  activeTimer: ActiveTimer | null;
}

export interface SetLog {
  id: string;
  scheduledId: string;               // FK -> scheduled (cascade delete)
  exerciseId: string;                // FK -> exercises (PERMANENT CONTRACT)
  setIndex: number;
  side: Side;                        // null for bilateral-agnostic
  load: number | null;
  unit: Units | null;
  reps: number | null;
  rpe: number | null;
  velocity: number | null;           // m/s
  distance: number | null;           // throws
  contacts: number | null;           // plyo
  completed: boolean;
  note: string | null;
  ts: number;
}

export interface EsdLog {
  id: string;
  scheduledId: string;               // FK -> scheduled (cascade delete)
  type: 'vo2max' | 'zone2';
  minutes: number;
  avgHr: number | null;
  peakHr: number | null;
  intervalsCompleted: number | null;
  counted: boolean;                  // met dosing signature -> counts in ledger
  modality: string | null;
  ts: number;
}

export interface TestResult {
  id: string;
  localDate: string;                 // YYYY-MM-DD local
  testId: string;                    // FK -> testDefs
  side: Side;
  value: number;
  unit: string;
  battery: 'full' | 'mini';
  note: string | null;
  ts: number;
}

/* ---------- STATIC STORES (seeded from code, not exported) ---------- */
/*
 * Shapes mirror program.seed.json. All carry `deprecated?: boolean`.
 * IDs are a PERMANENT CONTRACT: never rename, never reuse, never delete.
 * To retire an entry, set `deprecated: true` and leave the record in place —
 * historical setLogs hold these ids as foreign keys.
 */

export interface Lift {
  id: string;
  name: string;
  deprecated?: boolean;
}

/** Qualities the 28-day ledger tracks. */
export type LedgerKey =
  | 'velocityFull'
  | 'velocityPrime'
  | 'vo2max'
  | 'zone2Min'
  | 'trainingDays';

/** The three qualities earned by inspecting what was actually logged. */
export type CountableQuality = 'velocityFull' | 'velocityPrime' | 'vo2max';

/** How a target load is expressed for an exercise. */
export type LoadType =
  | 'pct1rm'
  | 'velocity'
  | 'rpe'
  | 'fixed'
  | 'hr'
  | 'bodyweight';

/** Which deload treatment row applies. Drives blocks.resolveDose(). */
export type DeloadElement =
  | 'maxIntentThrow'
  | 'grind'
  | 'ballistic'
  | 'plyo'
  | 'vo2max'
  | 'zone2'
  | 'recovery';

/** Per-exercise load configuration, read by the resolver. */
export interface LoadSpec {
  type: LoadType;
  /** pct1rm / velocity: percentage band of e1RM. */
  pctLow: number | null;
  pctHigh: number | null;
  /** velocity: the m/s floor the bar must hold. */
  velocityTarget: number | null;
  /** rpe: target RPE and optional reps-in-reserve. */
  rpeTarget: number | null;
  rirTarget: number | null;
  /** fixed: a literal load band, already in the profile's units. */
  fixedLow: number | null;
  fixedHigh: number | null;
  /** hr: percentage band of HRmax, resolved to bpm at render time. */
  hrPctLow: number | null;
  hrPctHigh: number | null;
  /**
   * Qualitative load wording carried verbatim from the program when it states
   * no number — "Heavy enough to threaten position", "Max hold". Rendered
   * instead of a resolved load, never alongside an invented one.
   */
  note?: string | null;
}

export interface Exercise {
  id: string;
  name: string;
  liftRef: string | null;            // FK -> lifts (null = not barbell-loaded)
  tags: string[];                    // substitutionTag ids may target these
  /**
   * Max-intent work. `velocityFull` requires >=1 completed set against a
   * maxIntent exercise in the template's power section — this is what makes a
   * TD1 whose throw block was cut fail to count as a TD1.
   */
  maxIntent: boolean;

  /* ---- prescription (placeholder values until the real program lands) ---- */

  /** Prescribed working sets. Drives how many set rows the runner renders. */
  sets: number;
  /** Reps per set. */
  reps: number;
  /** true -> logged separately per side, L and R, in the same row. */
  perSide: boolean;
  /** Rest between sets, seconds. */
  restSec: number;
  /** Why that rest length, shown on the timer bar. */
  restPurpose: string;
  /** What the set is FOR. Always visible — this replaces movement demos. */
  intent: string;
  /** When to stop the set. Always visible. */
  terminationRule: string;
  /** Where the prescription came from. */
  source: string;
  /** Easier variant, shown in the [i] sheet. */
  regression: string;
  /** Harder variant, shown in the [i] sheet. */
  progression: string;

  /**
   * Decay-termination factor, e.g. 0.95 for "terminate on 5% decay from the
   * best rep in the set". null = no decay rule, so no floor is displayed.
   */
  decayFloorFactor: number | null;
  /** Which logged field the decay floor reads. null when there is no rule. */
  decayMetric: 'velocity' | 'distance' | null;

  /** How this exercise's target load is expressed. */
  load: LoadSpec;
  /** Which deload treatment row applies to it. */
  deloadElement: DeloadElement;

  /* ---- carried verbatim from the program document ---- */

  /**
   * The literal prescribed dose when it is not a rep count — "15 yd", "4 min",
   * "30s". Rendered in place of the rep number, which would otherwise read as
   * a misleading "1".
   */
  doseLabel?: string;
  tempo?: string;
  /** A quality target rather than a load, e.g. "Ground contact time <180 ms". */
  target?: string;
  note?: string;
  modalityNote?: string;
  /** Exercise this one is deliberately paired with in the session. */
  pairedWith?: string;
  /** Ground contacts per set, for the plyo volume counter. */
  contactsPerSet?: number;
  warmup?: string;
  cooldown?: string;
  recoveryHrLow?: number;
  recoveryHrHigh?: number;
  /** A hard cap on total efforts for this exercise alone. */
  exerciseVolumeCap?: number;
  logVelocity?: boolean;
  logDistance?: boolean;
  logRSI?: boolean;
  logHR?: boolean;
  /** ESD only: the session offers an explicit abort that logs a missed exposure. */
  abortable?: boolean;

  deprecated?: boolean;
}

/** What a section is for. `power` is load-bearing: the ledger reads it. */
export type SectionRole =
  | 'pillar-prep'
  | 'movement-prep'
  | 'power'
  | 'plyo'
  | 'movement-skills'
  | 'strength'
  | 'accessory'
  | 'esd'
  | 'recovery';

export interface SessionTemplateSection {
  id: string;
  label: string;
  role: SectionRole;
  exerciseIds: string[];             // FK -> exercises
  /** The defining movement of this section. FK -> exercises, must be in exerciseIds. */
  primeExerciseId: string | null;
}

export interface SessionTemplate {
  id: string;
  name: string;
  position: RotationPosition;
  sections: SessionTemplateSection[];
  /**
   * Qualities this template is ELIGIBLE to contribute. Eligibility is not
   * achievement: a quality still has to be earned by what was logged.
   * A key absent here means the template can never contribute that quality.
   */
  ledger: Partial<Record<CountableQuality, true>>;
  /**
   * Compression cut maps, keyed by level. Resolved at runtime — never
   * hardcoded in a component.
   */
  compression: Partial<Record<'75' | '50' | '25', CompressionSpec>>;
  /** Why this template compresses the way it does. Shown at the decision point. */
  compressionRule: string;
  /** Live volume counters for this session type. */
  volumeCap: VolumeCap | null;

  /* ---- carried verbatim from the program document ---- */

  /** Neural and metabolic cost, 1-10. Drives the constraint warnings' rationale. */
  neural?: number;
  metabolic?: number;
  density?: string;
  /** The position this session must follow to be worth running. */
  mustFollow?: string;
  loadCeiling?: string;
  esdNote?: string;
  plyoNote?: string;
  note?: string;
  /** This template is the same session as another at a different density. */
  aliasOf?: string;
  isRecovery?: boolean;
  /** Recovery day rotating targets. */
  targetCycle?: RecoveryTarget[];
  hardConstraint?: string;
  deprecated?: boolean;
}

/** One rotating recovery-day target. */
export interface RecoveryTarget {
  target: string;
  ceiling: string;
  countsZone2: boolean;
  note: string | null;
}

export interface LedgerBounds {
  floor: number;
  ceiling: number | null;
}

/**
 * Block-level volume/intensity multipliers, applied FIRST in the resolution
 * order. Shipped at 1.0 — a pass-through — because the real per-block values
 * have never been supplied. Wiring them now means the order is enforced and
 * testable without inventing training numbers.
 */
export interface BlockMultipliers {
  volume: number;
  intensity: number;
}

export interface Block {
  id: string;
  name: string;
  weeks: number;
  /**
   * Rotation number that is this block's programmed deload position.
   * null when the block has none — a calibration block never deloads.
   */
  deloadRotation: number | null;
  /** Rotations in the block, and the training:recovery density they run at. */
  rotations?: number;
  density?: string;
  primary?: string;
  secondary?: string | null;
  /** Qualities held at a maintenance dose while the primary is developed. */
  maintains?: string[];
  /** What has to be true to leave the block. Display only — never a gate. */
  exitGate?: string;
  multipliers: BlockMultipliers;
  /** Floors/ceilings are per-block program data — never hardcoded in the engine. */
  floors: Record<LedgerKey, LedgerBounds>;
  deprecated?: boolean;
}

export interface SubstitutionTag {
  id: string;
  label: string;
  appliesTo: string[];               // FK -> exercises
  /** Rendered VERBATIM in the substitution sheet. */
  targetQuality: string;
  dosingSignature: string;
  validSubstitution: string;
  invalidSubstitution: string;
  failureMode: string | null;
  /** Which ledger quality a met substitution counts toward. */
  ledgerKey: CountableQuality | null;
  deprecated?: boolean;
}

/** One compression level's effect, resolved from the seed at runtime. */
export interface CompressionSpec {
  /** Exercise ids removed entirely. */
  cut?: string[];
  /** Exercise id -> replacement dose string. */
  modify?: Record<string, string>;
  /** Everything NOT listed is cut. Takes precedence over `cut`. */
  keepOnly?: string[];
  /** Shown at the top of the section. */
  note?: string;
}

/** A live counter shown in a section header. Never a gate. */
export interface VolumeCap {
  /** Header label, e.g. "THROWS". */
  label: string;
  limit: number;
  /**
   * What contributes: max-intent exercises, the section's prime only, or
   * plyo contacts. Counts reps (or contacts) across completed sets.
   */
  countOf: 'maxIntent' | 'prime' | 'contacts';
  /** Which Exos section header the counter belongs in. */
  section: SectionRole;
}

export interface TestDef {
  id: string;
  name: string;
  unit: string;
  battery: 'full' | 'mini' | 'both';
  bilateral: boolean;                // true -> results logged per side
  /**
   * Which direction counts as improvement. false for metrics where lower is
   * better — ground contact time, sprint splits. Getting this wrong renders a
   * genuine improvement in the regression colour, which is the exact bug the
   * field exists to prevent.
   */
  higherIsBetter: boolean;
  /**
   * Multi-value tests share a group id, and render indented under the parent.
   * null for standalone tests.
   */
  group: string | null;
  /** Counts toward the progression gate's power-metric tally. */
  powerMetric: boolean;
  /** Pass/fail tests have no chart, no delta, and require a note on fail. */
  kind: 'numeric' | 'passfail';
  /** The barbell lift this test estimates, when it is an e1RM test. */
  liftRef?: string;
  /** This test gates block progression. Display only. */
  gating?: boolean;
  note?: string | null;
  deprecated?: boolean;
}

/** The on-disk shape of src/data/program.seed.json. */
export interface ProgramSeed {
  seedVersion: number;
  lifts: Lift[];
  exercises: Exercise[];
  sessionTemplates: SessionTemplate[];
  blocks: Block[];
  substitutionTags: SubstitutionTag[];
  testDefs: TestDef[];
  /**
   * Cadence and gate thresholds are program data, not engine constants. The
   * engine's defaults must equal these; a unit test asserts it, so a future
   * program that changes them cannot silently disagree with the code.
   */
  testCadence: TestCadence;
  progressionGate: ProgressionGateSpec;
  deloadTreatment: Record<string, Record<string, number | boolean | string>>;
}

export interface TestCadence {
  fullBatteryTrainingDays: number;
  fullBatteryCalendarDays: number;
  miniBatteryTrainingDays: number;
  note?: string;
}

export interface ProgressionGateSpec {
  powerRegressionThreshold: number;
  note?: string;
}

/** The output of blocks.resolveDose(). */
export interface ResolvedDose {
  sets: number;
  reps: number;
  /** Plyo only; null elsewhere. */
  contacts: number | null;
  /** Fraction of the prescribed top-set intensity, 1 = uncapped. */
  topSetCap: number;
  /** Human-readable dose string, e.g. "4 × 3 / side". */
  label: string;
  /** True when the deload treatment changed anything. */
  deloaded: boolean;
  /** True when compression cut this exercise entirely. */
  cut: boolean;
  /** What was applied, in order, for display and debugging. */
  applied: string[];
}

/* ---------- BACKUP ENVELOPE ---------- */

export interface BackupFile {
  format: 'rotation-tracker-backup';
  schemaVersion: number;
  seedVersion: number;
  appVersion: string;
  exportedAt: string;                // ISO
  counts: Record<string, number>;    // integrity check per store
  data: {
    profile: Profile;
    maxes: MaxRecord[];
    scheduled: ScheduledSession[];
    setLogs: SetLog[];
    esdLogs: EsdLog[];
    tests: TestResult[];
  };
}

/* ---------- STORE NAME CONTRACTS ---------- */

export const USER_STORES = [
  'profile',
  'maxes',
  'scheduled',
  'setLogs',
  'esdLogs',
  'tests',
] as const;

export const STATIC_STORES = [
  'lifts',
  'exercises',
  'sessionTemplates',
  'blocks',
  'substitutionTags',
  'testDefs',
] as const;

export type UserStoreName = (typeof USER_STORES)[number];
export type StaticStoreName = (typeof STATIC_STORES)[number];

/* ---------- NAVIGATION (Phase 0 shell) ---------- */

export type TabId = 'dashboard' | 'calendar' | 'train' | 'tests' | 'reference';

export interface Tab {
  readonly id: TabId;
  readonly label: string;
}

export const TABS: readonly Tab[] = [
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'calendar', label: 'Calendar' },
  { id: 'train', label: 'Train' },
  { id: 'tests', label: 'Tests' },
  { id: 'reference', label: 'Reference' },
] as const;
