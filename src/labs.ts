/**
 * LOINC codes for each lab preset. Mirrors the LABS dictionary inside
 * clinical-primitives (src/components/Observation/ObservationFilters.ts), which
 * LabTrendPanel uses but the package does not export, plus 38445-3 (stool
 * calprotectin, mass/mass), which this cohort uses.
 */
export interface LabDef {
  label: string;
  loincs: readonly string[];
}

export const LAB_CODES: Record<string, LabDef> = {
  CRP:          { label: 'CRP',          loincs: ['1988-5', '14959-1', '71426-1'] },
  ESR:          { label: 'ESR',          loincs: ['30341-2', '4537-7'] },
  Calprotectin: { label: 'Calprotectin', loincs: ['35896-1', '27818-8', '38445-3'] },
  Albumin:      { label: 'Albumin',      loincs: ['1751-7', '3519-7', '2862-1'] },
  Hemoglobin:   { label: 'Hemoglobin',   loincs: ['718-7', '20509-6'] },
  Platelets:    { label: 'Platelets',    loincs: ['777-3', '26515-7'] },
  WBC:          { label: 'WBC',          loincs: ['6690-2', '26464-8'] },
  Ferritin:     { label: 'Ferritin',     loincs: ['2276-4', '20567-4'] },
  VitaminD:     { label: 'Vitamin D',    loincs: ['35365-7', '1989-3', '14635-7'] },
  VitaminB12:   { label: 'Vitamin B12',  loincs: ['2132-9', '14685-2'] },
  ALT:          { label: 'ALT',          loincs: ['1742-6', '1743-4'] },
  AST:          { label: 'AST',          loincs: ['1920-8', '30239-8'] },
  Weight:       { label: 'Weight',       loincs: ['29463-7', '3141-9'] },
  Height:       { label: 'Height',       loincs: ['8302-2', '3137-7'] },
  BMI:          { label: 'BMI',          loincs: ['39156-5'] },
};

/**
 * LOINC-only matching. LabTrendPanel also falls back to substring keyword
 * matching, which in this cohort pulls percentile observations ("BMI
 * [Percentile]", "Weight-for-length", both in %) into the BMI and Weight rows.
 * A chart has one unit per axis, so exact codes are used here instead.
 */
export function matchesLab(o: { code?: { coding?: { code?: string }[] } }, lab: LabDef): boolean {
  return !!o.code?.coding?.some(c => c.code && lab.loincs.includes(c.code));
}
