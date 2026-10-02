import type { Patient } from 'fhir/r4';

/** Synthea appends digits to names (e.g. "Janis361"); strip them for display. */
const clean = (s?: string) => (s ?? '').replace(/\d+$/, '');

export function displayName(p: Patient): string {
  const n = p.name?.find(n => n.use === 'official') ?? p.name?.[0];
  if (!n) return '(no name)';
  if (n.text) return n.text;
  const given = (n.given ?? []).map(clean).join(' ');
  return [given, clean(n.family)].filter(Boolean).join(' ') || '(no name)';
}

export function ageInYears(birthDate?: string, at: Date = new Date()): number | null {
  if (!birthDate) return null;
  const b = new Date(birthDate);
  if (Number.isNaN(b.getTime())) return null;
  let age = at.getFullYear() - b.getFullYear();
  const m = at.getMonth() - b.getMonth();
  if (m < 0 || (m === 0 && at.getDate() < b.getDate())) age--;
  return age;
}

export function mrn(p: Patient): string {
  const id = p.identifier?.find(i => i.type?.coding?.some(c => c.code === 'MR'));
  return id?.value ?? '';
}

export function cityState(p: Patient): string {
  const a = p.address?.[0];
  return [a?.city, a?.state].filter(Boolean).join(', ');
}

export interface PatientRow {
  id: string;
  name: string;
  gender: string;
  birthDate: string;
  age: number | null;
  mrn: string;
  location: string;
  deceased: boolean;
  resource: Patient;
  /** ISO start of the most recent visit / IBD clinic visit (sort keys). */
  lastVisit?: string;
  lastIbdVisit?: string;
  /** Cohort record-search result count; null while that record is loading. */
  matches?: number | null;
  /** ISO dates of the earliest and most recent record-search hit (sort keys). */
  firstMatch?: string;
  lastMatch?: string;
}

export function toRow(p: Patient): PatientRow {
  const deceasedAt = p.deceasedDateTime ? new Date(p.deceasedDateTime) : undefined;
  return {
    id: p.id ?? '',
    name: displayName(p),
    gender: p.gender ?? '',
    birthDate: p.birthDate ?? '',
    age: ageInYears(p.birthDate, deceasedAt),
    mrn: mrn(p),
    location: cityState(p),
    deceased: !!(p.deceasedBoolean || p.deceasedDateTime),
    resource: p,
  };
}
