/** HL7 v3 ActCode encounter classes, with display labels and timeline colors. */
export const ENCOUNTER_CLASSES: { code: string; label: string; color: string }[] = [
  { code: 'EMER',   label: 'Emergency',          color: 'var(--cp-color-amber)' },
  { code: 'IMP',    label: 'Inpatient',          color: 'var(--cp-color-red)' },
  { code: 'ACUTE',  label: 'Inpatient (acute)',  color: 'var(--cp-color-red)' },
  { code: 'NONAC',  label: 'Inpatient (non-acute)', color: 'var(--cp-color-red)' },
  { code: 'OBSENC', label: 'Observation',        color: 'var(--cp-color-purple)' },
  { code: 'SS',     label: 'Short stay',         color: 'var(--cp-color-purple)' },
  { code: 'AMB',    label: 'Ambulatory',         color: 'var(--cp-color-teal)' },
  { code: 'VR',     label: 'Virtual',            color: 'var(--cp-color-blue)' },
  { code: 'HH',     label: 'Home health',        color: 'var(--cp-color-green)' },
  { code: 'FLD',    label: 'Field',              color: 'var(--cp-color-green)' },
  { code: 'PRENC',  label: 'Pre-admission',      color: 'var(--cp-color-gray)' },
];

/** Shown as checkboxes; the rest are covered by "Other". */
export const COMMON_CLASSES = ['AMB', 'EMER', 'IMP', 'OBSENC', 'VR', 'HH'];
export const OTHER_CLASS = 'OTHER';

export function classInfo(code?: string) {
  return ENCOUNTER_CLASSES.find(c => c.code === code)
    ?? { code: code ?? '?', label: code ?? 'Unknown', color: 'var(--cp-color-gray)' };
}

/** Whether an encounter class is selected, treating uncommon classes as "Other". */
export function classSelected(code: string | undefined, selected: string[]) {
  return code && COMMON_CLASSES.includes(code) ? selected.includes(code) : selected.includes(OTHER_CLASS);
}
