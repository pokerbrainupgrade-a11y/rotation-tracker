export const SCHEMA_VERSION = 1;
export const SEED_VERSION = 1;

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

export interface Exercise {
  id: string;
  name: string;
  liftRef: string | null;            // FK -> lifts (null = not barbell-loaded)
  tags: string[];                    // substitutionTag ids may target these
  deprecated?: boolean;
}

export interface SessionTemplateSection {
  id: string;
  label: string;
  exerciseIds: string[];             // FK -> exercises
}

export interface SessionTemplate {
  id: string;
  name: string;
  position: RotationPosition;
  sections: SessionTemplateSection[];
  deprecated?: boolean;
}

export interface Block {
  id: string;
  name: string;
  weeks: number;
  deprecated?: boolean;
}

export interface SubstitutionTag {
  id: string;
  label: string;
  appliesTo: string[];               // FK -> exercises
  deprecated?: boolean;
}

export interface TestDef {
  id: string;
  name: string;
  unit: string;
  battery: 'full' | 'mini' | 'both';
  bilateral: boolean;                // true -> results logged per side
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
