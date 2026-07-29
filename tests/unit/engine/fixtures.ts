import type {
  Block,
  Exercise,
  SessionTemplate,
} from '../../../src/types';

/**
 * Engine fixtures. Deliberately independent of program.seed.json — the engine
 * must be correct for ANY conforming program, and the shipped seed is a
 * placeholder that will be replaced.
 */

export const exercises: Exercise[] = [
  { id: 'ex.throw', name: 'Throw', liftRef: null, tags: [], maxIntent: true },
  { id: 'ex.jump', name: 'Jump', liftRef: null, tags: [], maxIntent: true },
  { id: 'ex.squat', name: 'Squat', liftRef: 'lift.squat', tags: [], maxIntent: false },
  { id: 'ex.bike', name: 'Bike', liftRef: null, tags: [], maxIntent: false },
];

export const td1: SessionTemplate = {
  id: 'tmpl.td1',
  name: 'TD1',
  position: 'TD1',
  sections: [
    {
      id: 'sec.power',
      label: 'Power',
      role: 'power',
      exerciseIds: ['ex.throw', 'ex.jump'],
      primeExerciseId: 'ex.throw',
    },
    {
      id: 'sec.strength',
      label: 'Strength',
      role: 'strength',
      exerciseIds: ['ex.squat'],
      primeExerciseId: 'ex.squat',
    },
  ],
  ledger: { velocityFull: true, velocityPrime: true },
};

export const td2: SessionTemplate = {
  id: 'tmpl.td2',
  name: 'TD2',
  position: 'TD2',
  sections: [
    {
      id: 'sec.td2.main',
      label: 'Main',
      role: 'strength',
      exerciseIds: ['ex.squat'],
      primeExerciseId: 'ex.squat',
    },
  ],
  ledger: {},
};

export const td3: SessionTemplate = {
  id: 'tmpl.td3',
  name: 'TD3',
  position: 'TD3',
  sections: [
    {
      id: 'sec.td3.esd',
      label: 'ESD',
      role: 'esd',
      exerciseIds: ['ex.bike'],
      primeExerciseId: 'ex.bike',
    },
  ],
  ledger: { vo2max: true },
};

export const rd: SessionTemplate = {
  id: 'tmpl.rd',
  name: 'RD',
  position: 'RD',
  sections: [
    {
      id: 'sec.rd',
      label: 'Recovery',
      role: 'recovery',
      exerciseIds: ['ex.bike'],
      primeExerciseId: null,
    },
  ],
  ledger: {},
};

export const templates: SessionTemplate[] = [td1, td2, td3, rd];

export function block(over: Partial<Block> = {}): Block {
  return {
    id: 'block.a',
    name: 'Block A',
    weeks: 4,
    floors: {
      velocityFull: { floor: 4, ceiling: null },
      velocityPrime: { floor: 6, ceiling: null },
      vo2max: { floor: 4, ceiling: 6 },
      zone2Min: { floor: 180, ceiling: null },
      trainingDays: { floor: 16, ceiling: 22 },
    },
    ...over,
  };
}

/** A second block with different floors — proves floors are read, not baked in. */
export const blockB = block({
  id: 'block.b',
  name: 'Block B',
  floors: {
    velocityFull: { floor: 1, ceiling: null },
    velocityPrime: { floor: 1, ceiling: null },
    vo2max: { floor: 1, ceiling: 3 },
    zone2Min: { floor: 10, ceiling: null },
    trainingDays: { floor: 2, ceiling: 10 },
  },
});
