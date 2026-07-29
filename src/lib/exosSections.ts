import type { SectionRole } from '../types';

/**
 * The fixed Exos sequence. Every session runs these in this order, regardless
 * of which of them the template actually populates — a stable spine means the
 * screen looks the same on every session type.
 */
export const EXOS_ORDER = [
  'pillar-prep',
  'movement-prep',
  'power',
  'movement-skills',
  'strength',
  'esd',
  'recovery',
] as const;

export type ExosSection = (typeof EXOS_ORDER)[number];

export const EXOS_LABEL: Record<ExosSection, string> = {
  'pillar-prep': 'PILLAR PREP',
  'movement-prep': 'MOVEMENT PREP',
  power: 'PLYO / MED BALL / ROTATIONAL POWER',
  'movement-skills': 'MOVEMENT SKILLS',
  strength: 'STRENGTH & POWER',
  esd: 'ESD',
  recovery: 'REGENERATION',
};

/** Template section role -> Exos section it belongs to. */
export function exosSectionFor(role: SectionRole): ExosSection {
  switch (role) {
    case 'pillar-prep': return 'pillar-prep';
    case 'movement-prep': return 'movement-prep';
    case 'power':
    case 'plyo': return 'power';
    case 'movement-skills': return 'movement-skills';
    case 'strength':
    case 'accessory': return 'strength';
    case 'esd': return 'esd';
    case 'recovery': return 'recovery';
  }
}

/**
 * Checklist sections are tapped through, not logged. Pillar Prep in particular
 * has NO skip control anywhere in the UI: it can be left unchecked and records
 * as incomplete, but the app never offers to dismiss it.
 */
export const CHECKLIST_SECTIONS: ExosSection[] = ['pillar-prep', 'movement-prep'];

export function isChecklist(section: ExosSection): boolean {
  return CHECKLIST_SECTIONS.includes(section);
}
