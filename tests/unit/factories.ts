import type {
  EsdLog,
  MaxRecord,
  ScheduledSession,
  SetLog,
  TestResult,
} from '../../src/types';
import { SEED_VERSION } from '../../src/types';

/**
 * Deterministic fixtures. No Math.random / Date.now — a test that fails only
 * on some runs is worse than no test.
 */

export function session(over: Partial<ScheduledSession> = {}): ScheduledSession {
  return {
    id: 'sess-1',
    localDate: '2026-03-10',
    ts: 1_772_000_000_000,
    templateId: 'TD2',
    position: 'TD2',
    blockId: 'b1',
    rotationNumber: 1,
    status: 'done',
    compressionLevel: 100,
    deload: false,
    substituted: false,
    substitutionNote: null,
    metDosingSignature: null,
    startedAt: null,
    completedAt: 1_772_003_600_000,
    seedVersionAtLog: SEED_VERSION,
    checklist: [],
    activeTimer: null,
    ...over,
  };
}

export function setLog(over: Partial<SetLog> = {}): SetLog {
  return {
    id: 'set-1',
    scheduledId: 'sess-1',
    exerciseId: 'ex_trapbar',
    setIndex: 0,
    side: null,
    load: 315,
    unit: 'lb',
    reps: 3,
    rpe: 8,
    velocity: null,
    distance: null,
    contacts: null,
    completed: true,
    note: null,
    ts: 1_772_000_100_000,
    ...over,
  };
}

export function esdLog(over: Partial<EsdLog> = {}): EsdLog {
  return {
    id: 'esd-1',
    scheduledId: 'sess-1',
    type: 'vo2max',
    minutes: 24,
    avgHr: 158,
    peakHr: 181,
    intervalsCompleted: 6,
    counted: true,
    modality: 'bike',
    ts: 1_772_002_000_000,
    ...over,
  };
}

export function maxRecord(over: Partial<MaxRecord> = {}): MaxRecord {
  return {
    liftId: 'trapbar',
    e1rm: 405,
    unit: 'lb',
    testedOn: '2026-03-01',
    method: 'tested',
    ...over,
  };
}

export function testResult(over: Partial<TestResult> = {}): TestResult {
  return {
    id: 'test-1',
    localDate: '2026-03-02',
    testId: 't_cmj',
    side: null,
    value: 41.5,
    unit: 'cm',
    battery: 'full',
    note: null,
    ts: 1_771_400_000_000,
    ...over,
  };
}
