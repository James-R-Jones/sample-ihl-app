/**
 * The current patient's values for the cube's stratifiers, each with where it
 * came from. Values follow the cube's data dictionary:
 *
 * - Age at diagnosis: whole years (days / 365, floored) from birth to the
 *   earliest IBD diagnosis.
 * - Subtype: the earliest IBD diagnosis (subtype at diagnosis).
 * - Severity at presentation, from notes up to 30 days after diagnosis
 *   (later scores reflect treatment). For colitis and IBD-U, the first PUCAI
 *   (under 35 mild, 35 to 64 moderate, 65 and over severe). For
 *   Crohn's disease, severe when there is perianal disease, stricturing or
 *   penetrating behavior (Paris B2/B3), or growth failure; otherwise the first
 *   PCDAI if one is documented (under 30 mild, 30 to 39 moderate, 40 and over
 *   severe), else unknown.
 * - Perianal disease (Crohn's only): the Paris "p" modifier on the first
 *   documented Crohn behavior, or a perianal fistula or abscess diagnosis.
 *
 * None of these are coded as structured data in the synthetic cohort apart
 * from gender, birth date and the diagnosis, so severity and perianal disease
 * are read from note text.
 */
import type { Condition, DocumentReference, MedicationRequest, Patient } from 'fhir/r4';
import { attachmentText } from '../encounter';
import type { Therapy } from './cube';

export interface Derived<T> {
  value: T | null;
  /** Where the value came from, or why there is none. */
  source: string;
  date?: string;
}

export interface IbdProfile {
  diagnosisDate?: string;
  age: Derived<number>;
  gender: Derived<number>;      // 0 male, 1 female
  subtype: Derived<number>;     // 0 Crohn's, 1 UC, 2 IBD-U
  severity: Derived<number>;    // 0 mild, 1 moderate, 2 severe
  perianal: Derived<number>;    // 0 yes, 1 no
  /** The patient's own first-line therapy, if the record shows one. */
  firstLine?: { therapy: Therapy; drug: string; date?: string };
}

const SUBTYPES: { re: RegExp; subtype: number }[] = [
  // SNOMED CT and ICD-10-CM codes for the three subtypes.
  { re: /^(34000006|K50(\..*)?)$/, subtype: 0 },
  { re: /^(64766004|K51(\..*)?)$/, subtype: 1 },
  { re: /^(K52\.3|61015002)$/, subtype: 2 },
];

const GROWTH_FAILURE = /^(R62\.5\d?|R62\.0|432250007|36440009|54840006)$/;
const PERIANAL_DX = /^(K60\.[345]|K61\.[0-4]?|K50\.\d13|K50\.\d14)$/;

const day = (s?: string) => s?.slice(0, 10);
const when = (c: Condition) => c.onsetDateTime ?? c.onsetPeriod?.start ?? c.recordedDate;
const codes = (c: Condition) => (c.code?.coding ?? []).map(x => x.code ?? '');
const fmt = (s?: string) => (s ? new Date(s).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' }) : '');
/** Scores count as "at presentation" up to this many days after diagnosis. */
const PRESENTATION_DAYS = 30;

function noteTexts(docs: DocumentReference[]) {
  return docs
    .map(d => ({
      date: d.date ?? d.context?.period?.start,
      type: d.type?.text ?? d.type?.coding?.[0]?.display ?? 'Note',
      text: (d.content ?? []).map(c => (c.attachment ? attachmentText(c.attachment) : null) ?? '').join('\n'),
    }))
    .filter(n => n.text)
    .sort((a, b) => (a.date ?? '').localeCompare(b.date ?? ''));
}

/** First note (by date) whose text matches, with the match. */
function firstMatch(notes: ReturnType<typeof noteTexts>, re: RegExp) {
  for (const n of notes) { const m = n.text.match(re); if (m) return { note: n, m }; }
  return null;
}

const THERAPY_DRUGS: { therapy: Therapy; re: RegExp }[] = [
  { therapy: 'ANTI_TNF', re: /infliximab|adalimumab|certolizumab|golimumab/i },
  { therapy: 'ANTI_INTEGRIN', re: /vedolizumab|natalizumab/i },
  { therapy: 'ANTI_INTERLEUKIN', re: /ustekinumab|risankizumab|mirikizumab|guselkumab/i },
  { therapy: 'JAK_INHIBITOR', re: /tofacitinib|upadacitinib|filgotinib/i },
  { therapy: 'IMMUNOMODULATOR', re: /methotrexate|azathioprine|mercaptopurine/i },
  { therapy: 'AMINOSALICYLATE', re: /mesalamine|mesalazine|sulfasalazine|balsalazide|olsalazine/i },
];

function medName(m: MedicationRequest) {
  return m.medicationCodeableConcept?.text ?? m.medicationCodeableConcept?.coding?.[0]?.display ?? '';
}

export function deriveProfile(patient: Patient, resources: Record<string, unknown[]>): IbdProfile {
  const conditions = (resources.Condition ?? []) as Condition[];
  const allNotes = noteTexts((resources.DocumentReference ?? []) as DocumentReference[]);
  const meds = (resources.MedicationRequest ?? []) as MedicationRequest[];

  // Diagnosis and subtype
  const dx = conditions
    .map(c => ({ c, date: when(c), sub: SUBTYPES.find(s => codes(c).some(code => s.re.test(code)))?.subtype }))
    .filter((x): x is { c: Condition; date: string; sub: number } => x.sub != null && !!x.date)
    .sort((a, b) => a.date.localeCompare(b.date));
  const first = dx[0];
  // Severity scores and Paris classification at presentation: notes up to
  // PRESENTATION_DAYS after diagnosis (later scores reflect treatment).
  const cutoff = first ? new Date(Date.parse(first.date) + PRESENTATION_DAYS * 864e5).toISOString() : '';
  const notes = first ? allNotes.filter(n => (n.date ?? '') <= cutoff) : [];
  const dxName = first ? (first.c.code?.text ?? first.c.code?.coding?.[0]?.display ?? 'IBD') : '';
  const subtype: Derived<number> = first
    ? { value: first.sub, source: `${dxName} diagnosis, ${fmt(first.date)}`, date: first.date }
    : { value: null, source: 'No Crohn\'s disease, ulcerative colitis or IBD-U diagnosis in the record' };

  // Age at diagnosis
  let age: Derived<number>;
  if (!first) age = { value: null, source: 'No IBD diagnosis date' };
  else if (!patient.birthDate) age = { value: null, source: 'Birth date not in the record' };
  else {
    const days = (Date.parse(day(first.date)!) - Date.parse(patient.birthDate)) / 864e5;
    const years = Math.floor(days / 365);
    age = years >= 0 && years <= 17
      ? { value: years, source: `Birth date to diagnosis on ${fmt(first.date)}` }
      : { value: null, source: `Diagnosed at ${years} years, outside the cube's 0 to 17` };
  }

  // Gender
  const g = patient.gender === 'male' ? 0 : patient.gender === 'female' ? 1 : null;
  const gender: Derived<number> = { value: g, source: g == null ? `Recorded as ${patient.gender ?? 'unknown'}` : 'Patient record' };

  // Perianal disease and Crohn's severity
  const behavior = firstMatch(notes, /Crohn behavior:\s*(B[123](?:B3)?)(p?)/i);
  const perianalDx = conditions.find(c => codes(c).some(code => PERIANAL_DX.test(code)) || /perianal (fistula|abscess|disease)/i.test(c.code?.text ?? ''));
  let perianal: Derived<number>;
  if (first?.sub !== 0) perianal = { value: null, source: 'Assessed for Crohn\'s disease only' };
  else if (perianalDx) perianal = { value: 0, source: `${perianalDx.code?.text ?? 'Perianal'} diagnosis, ${fmt(when(perianalDx))}` };
  else if (behavior) perianal = behavior.m[2]
    ? { value: 0, source: `Paris ${behavior.m[1]}${behavior.m[2]} in ${behavior.note.type.toLowerCase()}, ${fmt(behavior.note.date)}` }
    : { value: 1, source: `Paris ${behavior.m[1]} with no perianal modifier, ${behavior.note.type.toLowerCase()} ${fmt(behavior.note.date)}` };
  else perianal = { value: null, source: 'No Paris classification or perianal diagnosis at diagnosis' };

  let severity: Derived<number>;
  if (!first) severity = { value: null, source: 'No IBD diagnosis' };
  else if (first.sub === 0) {
    const growth = conditions.find(c => codes(c).some(code => GROWTH_FAILURE.test(code)));
    const pcdai = firstMatch(notes, /PCDAI:?\s*(\d+(?:\.\d+)?)/i);
    if (perianal.value === 0) severity = { value: 2, source: 'Perianal disease sets Crohn\'s severity to severe' };
    else if (behavior && /B[23]/i.test(behavior.m[1])) severity = { value: 2, source: `Paris ${behavior.m[1]} (stricturing or penetrating) sets severity to severe` };
    else if (growth) severity = { value: 2, source: `${growth.code?.text ?? 'Growth failure'} (${fmt(when(growth))}) sets severity to severe` };
    else if (pcdai) {
      const v = Number(pcdai.m[1]);
      severity = { value: v < 30 ? 0 : v < 40 ? 1 : 2, source: `PCDAI ${v} in ${pcdai.note.type.toLowerCase()}, ${fmt(pcdai.note.date)}` };
    } else severity = { value: null, source: 'No perianal disease, B2/B3 behavior or growth failure, and no PCDAI at diagnosis, so mild or moderate' };
  } else {
    const pucai = firstMatch(notes, /PUCAI:?\s*(\d+)/i);
    if (pucai) {
      const v = Number(pucai.m[1]);
      severity = { value: v < 35 ? 0 : v < 65 ? 1 : 2, source: `PUCAI ${v} in ${pucai.note.type.toLowerCase()}, ${fmt(pucai.note.date)}` };
    } else severity = { value: null, source: 'No PUCAI documented at diagnosis' };
  }

  // The patient's own first-line therapy: the earliest non-steroid IBD drug.
  let firstLine: IbdProfile['firstLine'];
  for (const m of [...meds].sort((a, b) => (a.authoredOn ?? '').localeCompare(b.authoredOn ?? ''))) {
    const name = medName(m);
    const hit = THERAPY_DRUGS.find(t => t.re.test(name));
    if (hit) { firstLine = { therapy: hit.therapy, drug: name, date: m.authoredOn }; break; }
  }

  return { diagnosisDate: first?.date, age, gender, subtype, severity, perianal, firstLine };
}
