import type { DBSchema } from 'idb';
import type {
  Block,
  EsdLog,
  Exercise,
  Lift,
  MaxRecord,
  Profile,
  ScheduledSession,
  SessionTemplate,
  SetLog,
  SubstitutionTag,
  TestDef,
  TestResult,
} from '../types';

export const DB_NAME = 'rotationTracker';

/**
 * IndexedDB structure. Kept separate from migrations.ts so the migration
 * registry can import these types without a cycle.
 */
export interface RotationDB extends DBSchema {
  // --- user stores ---
  profile: { key: string; value: Profile };
  maxes: { key: string; value: MaxRecord };
  scheduled: {
    key: string;
    value: ScheduledSession;
    indexes: { localDate: string; status: string; blockId: string };
  };
  setLogs: {
    key: string;
    value: SetLog;
    indexes: { scheduledId: string; exerciseId: string };
  };
  esdLogs: {
    key: string;
    value: EsdLog;
    indexes: { scheduledId: string; type: string };
  };
  tests: {
    key: string;
    value: TestResult;
    indexes: { localDate: string; testId: string };
  };

  // --- static stores ---
  lifts: { key: string; value: Lift };
  exercises: { key: string; value: Exercise };
  sessionTemplates: { key: string; value: SessionTemplate };
  blocks: { key: string; value: Block };
  substitutionTags: { key: string; value: SubstitutionTag };
  testDefs: { key: string; value: TestDef };
}
