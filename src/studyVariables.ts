/**
 * Patient-level study variables from sds-study-variables (the Cumulus IBD
 * study, cumulus-library-ibd-cds), for the Study variables section and the
 * Therapy outcomes profile.
 *
 * - Base: the FHIR base `{origin}/…/fhir/{cohort}` becomes
 *   `{origin}/…/study/ibd/cohort/{cohort}_db` (cumulus_sim_ibd_v2 →
 *   cumulus_sim_ibd_v2_db). Other cohorts answer 403 and are treated as not
 *   having study data.
 * - `subject_ref` is sent as the bare FHIR Patient.id. The service hashes it
 *   into the study's own `Patient/<sha>` reference. `Patient/<id>`, the form
 *   the starter kit documents, fails with no CORS headers (2026-10-12).
 * - `version=007` matches the synthetic data.
 * - POST /patient/summary (about 6 s) and POST /patient (about 9 s, 240 KB,
 *   mostly timeline and encounter rows). Only the summary and the small
 *   tables are kept, in localStorage for a day.
 * - `source_refs` are hashed ids too, so they cannot be opened in the FHIR
 *   record; they are shown as counts.
 */
import { useEffect, useState } from 'react';
import { FHIR_API_BASE } from './config';

export const STUDY_VERSION = '007';

export function studyBase(base = FHIR_API_BASE): string | null {
  const m = base.match(/^(https?:\/\/.+)\/fhir\/([^/]+)$/);
  return m ? `${m[1]}/study/ibd/cohort/${m[2]}_db` : null;
}

export interface SummaryField {
  label: string;
  category: string;
  value: unknown;
  source_refs: string[];
  display?: string | null;
  description?: string | null;
  details?: string | null;
  type?: string | null;
}

export type Row = Record<string, string | number | boolean | null>;

export interface StudyPatient {
  fields: Record<string, SummaryField>;
  subject?: Row;
  therapyLines: Row[];
  therapyClasses: Row[];
  outcomes: Row[];
}

/** Tables kept from POST /patient (the rest are large and not used yet). */
const KEEP = {
  ibd__client_subject: 'subject',
  ibd__client_therapy_line: 'therapyLines',
  ibd__client_therapy_line_class: 'therapyClasses',
  ibd__client_outcome: 'outcomes',
} as const;

const CACHE_KEY = 'ihl-patient-app.study.v1';
const TTL = 864e5;
type Cache = Record<string, { at: number; data: StudyPatient }>;
const readCache = (): Cache => { try { return JSON.parse(localStorage.getItem(CACHE_KEY) ?? '{}'); } catch { return {}; } };
function writeCache(key: string, data: StudyPatient) {
  try {
    const now = Date.now();
    const all = Object.fromEntries(Object.entries(readCache()).filter(([, v]) => now - v.at < TTL));
    all[key] = { at: now, data };
    localStorage.setItem(CACHE_KEY, JSON.stringify(all));
  } catch { /* ignore */ }
}

export class NoStudyData extends Error {}

async function post<T>(base: string, path: string, id: string): Promise<T> {
  const url = `${base}${path}?version=${STUDY_VERSION}`;
  for (let attempt = 0; ; attempt++) {
    let res: Response;
    try {
      res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ subject_ref: id }) });
    } catch (e) {
      // Upstream errors arrive without CORS headers; the first call after a while sometimes fails.
      if (attempt < 1) continue;
      throw new Error('the study API returned an error');
    }
    if (res.ok) return res.json() as Promise<T>;
    const detail = await res.json().then(j => j?.detail, () => null);
    if (res.status === 403 || res.status === 404) throw new NoStudyData('No study data for this data source');
    if (res.status === 400 && /could not find/i.test(String(detail))) throw new NoStudyData('This patient is not in the study data');
    if (attempt < 1 && res.status >= 500) continue;
    throw new Error(`Study API HTTP ${res.status}${detail ? `: ${detail}` : ''}`);
  }
}

/**
 * Whether the study API serves this cohort. Patient routes for a cohort it
 * doesn't allow fail without CORS headers, so ask the cube catalog first,
 * which answers 403 readably (or not at all, for a host with no study API).
 * Once per page load.
 */
let available: Promise<boolean> | null = null;
function studyAvailable(base: string): Promise<boolean> {
  available ??= fetch(`${base}/details?version=${STUDY_VERSION}`).then(r => r.ok, () => false);
  return available;
}

const inflight = new Map<string, Promise<StudyPatient>>();

export function loadStudyPatient(id: string): Promise<StudyPatient> {
  const base = studyBase();
  if (!base) return Promise.reject(new NoStudyData('No study data for this data source'));
  const key = `${base}|${id}`;
  const hit = readCache()[key];
  if (hit && Date.now() - hit.at < TTL) return Promise.resolve(hit.data);
  let p = inflight.get(key);
  if (p) return p;
  p = (async () => {
    if (!(await studyAvailable(base))) throw new NoStudyData('No study data for this data source');
    const [summary, tables] = await Promise.all([
      post<{ fields: Record<string, SummaryField> }>(base, '/patient/summary', id),
      post<{ details: { name: string; rows: Row[] }[] }>(base, '/patient', id),
    ]);
    const data: StudyPatient = { fields: summary.fields ?? {}, therapyLines: [], therapyClasses: [], outcomes: [] };
    for (const t of tables.details ?? []) {
      const k = KEEP[t.name as keyof typeof KEEP];
      if (k === 'subject') data.subject = t.rows[0];
      else if (k) data[k] = t.rows;
    }
    writeCache(key, data);
    return data;
  })();
  p.catch(() => {}).finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

export type StudyState =
  | { status: 'loading' }
  | { status: 'ready'; data: StudyPatient; ms: number }
  | { status: 'none'; reason: string }
  | { status: 'error'; error: string };

/** One patient's study variables; `enabled` false skips the call. */
export function useStudyPatient(id: string, enabled = true): StudyState {
  const [state, setState] = useState<StudyState>({ status: 'loading' });
  useEffect(() => {
    if (!enabled) { setState({ status: 'none', reason: 'Turned off' }); return; }
    let live = true;
    const t0 = performance.now();
    setState({ status: 'loading' });
    loadStudyPatient(id).then(
      data => live && setState({ status: 'ready', data, ms: Math.round(performance.now() - t0) }),
      e => live && setState(e instanceof NoStudyData ? { status: 'none', reason: e.message } : { status: 'error', error: String(e?.message ?? e) }),
    );
    return () => { live = false; };
  }, [id, enabled]);
  return state;
}
