/**
 * Most recent visit and most recent IBD clinic visit per patient, from two
 * cohort-wide calls (encounters, and note types), not each full record.
 */
import type { DocumentReference, Encounter } from 'fhir/r4';
import { listAllResources } from './api';

export interface VisitInfo {
  encounterId: string;
  /** ISO start time; also the sort key. */
  date: string;
  /** Visit type, e.g. "Follow-up encounter". */
  label: string;
  /** Reason, e.g. "Crohn's disease". */
  reason?: string;
}

export interface VisitSummary { last?: VisitInfo; lastIbd?: VisitInfo }

/** IBD diagnoses that make an outpatient visit an IBD clinic visit. */
const IBD_CODES = new Set([
  '34000006',  // Crohn's disease (SNOMED)
  '64766004',  // Ulcerative colitis (SNOMED)
  '24526004',  // Inflammatory bowel disease (SNOMED)
  'K50', 'K51', 'K52.3', 'K52.9', // ICD-10: Crohn's, UC, indeterminate colitis, suspected IBD
]);
const IBD_TEXT = /crohn|ulcerative colitis|indeterminate colitis|inflammatory bowel/i;

/** Note types written by the pediatric GI clinic. */
const GI_NOTE = /gastroenterology/i;

const OUTPATIENT = new Set(['AMB', 'VR']);

const clean = (s?: string) => (s ?? '').replace(/ \((procedure|disorder|finding|environment|regime\/therapy|situation)\)$/, '');

function ibdReason(e: Encounter): string | undefined {
  for (const r of e.reasonCode ?? []) {
    const c = r.coding?.[0];
    const code = c?.code ?? '';
    const text = r.text ?? c?.display ?? '';
    if (IBD_CODES.has(code) || IBD_CODES.has(code.split('.')[0]) || IBD_TEXT.test(text)) return clean(text) || code;
  }
  return undefined;
}

/**
 * An IBD clinic visit: an outpatient or virtual encounter whose reason is an
 * IBD diagnosis (pathology consults excluded), or any encounter with a
 * pediatric gastroenterology note.
 */
export function isIbdClinicVisit(e: Encounter, giNoteEncounters: Set<string>): boolean {
  if (e.id && giNoteEncounters.has(e.id)) return true;
  if (!OUTPATIENT.has(e.class?.code ?? '')) return false;
  if (/histopathology/i.test(e.type?.[0]?.text ?? '')) return false;
  return !!ibdReason(e);
}

let cache: Promise<Map<string, VisitSummary>> | null = null;

export function loadVisitSummaries(refresh = false): Promise<Map<string, VisitSummary>> {
  if (!cache || refresh) {
    cache = build();
    cache.catch(() => { cache = null; });
  }
  return cache;
}

async function build(): Promise<Map<string, VisitSummary>> {
  const [encounters, docs] = await Promise.all([
    listAllResources<Encounter>('Encounter', { fields: ['id', 'class', 'type', 'period', 'reasonCode', 'subject'], limit: 1000 }),
    listAllResources<DocumentReference>('DocumentReference', { fields: ['id', 'type', 'context'], limit: 1000 }),
  ]);
  const giNoteEncounters = new Set(docs
    .filter(d => GI_NOTE.test(d.type?.text ?? d.type?.coding?.[0]?.display ?? ''))
    .flatMap(d => (d.context?.encounter ?? []).map(r => r.reference?.split('/').pop() ?? '')));

  // Visits dated in the future (scheduled, or synthetic-data drift) don't count as "most recent".
  const now = new Date().toISOString();
  const out = new Map<string, VisitSummary>();
  for (const e of encounters) {
    const patientId = e.subject?.reference?.split('/').pop();
    const date = e.period?.start;
    if (!patientId || !e.id || !date || date > now) continue;
    const info: VisitInfo = {
      encounterId: e.id,
      date,
      label: clean(e.type?.[0]?.text ?? e.type?.[0]?.coding?.[0]?.display) || 'Visit',
      reason: ibdReason(e) ?? (clean(e.reasonCode?.[0]?.text ?? e.reasonCode?.[0]?.coding?.[0]?.display) || undefined),
    };
    const s = out.get(patientId) ?? {};
    if (!s.last || date > s.last.date) s.last = info;
    if (isIbdClinicVisit(e, giNoteEncounters) && (!s.lastIbd || date > s.lastIbd.date)) s.lastIbd = info;
    out.set(patientId, s);
  }
  return out;
}
