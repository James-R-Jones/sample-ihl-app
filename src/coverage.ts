/**
 * What the other APIs hold for each patient in the list, for the patient
 * list's Genomics and Notes indexed columns.
 *
 * - Genomics (probands only): two variant queries per child sample, the same
 *   ones the Genomic findings section starts with, so their execution ids are
 *   shared and remembered for 44 days (genomics.ts runQuery):
 *     rare: gnomAD frequency under 1% and classified pathogenic, likely
 *           pathogenic, conflicting or VUS (the section's default filter
 *           before its gene and coding filters);
 *     P/LP: classified pathogenic or likely pathogenic, any frequency.
 *   About 13 s for all ten probands in parallel on 2026-10-12, uncached.
 * - Notes indexed: notes for the patient in the sds-es-fhir index. One
 *   cohort-wide notes search per patient with the patient id as the keyword,
 *   which matches that patient's notes through their subject reference
 *   (0.4 to 10 s and up to about 1 MB each on 2026-10-12), three at a time.
 *   OR-ing several ids into one call is quicker but some combinations fail
 *   with no CORS headers, so each id goes on its own, retried once. Counts
 *   are kept for the browser session.
 */
import { useEffect, useState } from 'react';
import { listSamples, runQuery } from './genomics';
import { ftsUrl, searchCohortNotes } from './serverSearch';

export type Coverage<T> = {
  status: 'loading' | 'ready' | 'unsupported' | 'error';
  /** Patients the API has data for, with what it has. */
  data: Map<string, T>;
  /** Patients that could not be checked. */
  unknown: Set<string>;
  error?: string;
};
type Loader<T> = (ids: string[], update: (data: Map<string, T>, unknown: Set<string>, error?: string) => void) => Promise<void>;

/** Runs `check` over ids, `n` at a time; failures are collected, not thrown. */
async function pool<T>(ids: string[], n: number, check: (id: string) => Promise<T | null>,
  update: (data: Map<string, T>, unknown: Set<string>, error?: string) => void, seed = new Map<string, T>()) {
  const data = new Map(seed);
  const unknown = new Set<string>();
  let error: string | undefined;
  const queue = [...ids];
  update(new Map(data), new Set(unknown));
  await Promise.all(Array.from({ length: n }, async () => {
    while (queue.length) {
      const id = queue.shift()!;
      try { const v = await check(id); if (v != null) data.set(id, v); }
      catch (e) { unknown.add(id); error = String((e as Error)?.message ?? e); }
      update(new Map(data), new Set(unknown), error);
    }
  }));
  if (ids.length && unknown.size === ids.length) throw new Error(error);
}

/** `enabled` false waits (status stays loading) without calling anything. */
function useCoverage<T>(ids: string[], load: Loader<T> | null, enabled = true): Coverage<T> {
  const [state, setState] = useState<Coverage<T>>({ status: load ? 'loading' : 'unsupported', data: new Map(), unknown: new Set() });
  const key = ids.join(',');
  useEffect(() => {
    if (!load) { setState({ status: 'unsupported', data: new Map(), unknown: new Set() }); return; }
    if (!enabled) return;
    if (!ids.length) return;
    let live = true;
    setState(s => ({ ...s, status: 'loading' }));
    load(ids, (data, unknown, error) => live && setState({ status: 'loading', data, unknown, error })).then(
      () => live && setState(s => ({ ...s, status: 'ready' })),
      e => live && setState(s => ({ ...s, status: 'error', error: String(e?.message ?? e) })),
    );
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, !!load, enabled]);
  return state;
}

/* ---------- genomics ---------- */

export interface VariantCounts { sampleId: string; rare: number; plp: number }

const VARIANTS = '/query/variant?offset=0&limit=1000';
const RARE = { frequency: { operator: '<', value: 0.01 }, pathogenicity: ['Pathogenic', 'Likely_pathogenic', 'Conflicting_classifications_of_pathogenicity', 'VUS'] };
const PLP = { pathogenicity: ['Pathogenic', 'Likely_pathogenic'] };

const genomicsLoad: Loader<VariantCounts> = async (ids, update) => {
  const samples = new Map((await listSamples()).map(s => [s.subject.replace(/^Patient\//, ''), s.sampleId]));
  const withSample = ids.filter(id => samples.has(id));
  await pool(withSample, withSample.length, async id => {
    const [rare, plp] = await Promise.all([
      runQuery<unknown[]>(VARIANTS, { ...RARE, patient_refs: [id] }),
      runQuery<unknown[]>(VARIANTS, { ...PLP, patient_refs: [id] }),
    ]);
    return { sampleId: samples.get(id)!, rare: rare.length, plp: plp.length };
  }, update);
};

/* ---------- notes indexed (fhirfts) ---------- */

const FTS_KEY = 'ihl-patient-app.ftsIndexed.v2';
type FtsCache = { url: string; counts: Record<string, number> };
const readFts = (url: string): FtsCache => {
  try { const c = JSON.parse(sessionStorage.getItem(FTS_KEY) ?? 'null'); if (c?.url === url) return c; } catch { /* ignore */ }
  return { url, counts: {} };
};

const ftsLoad: Loader<number> = async (ids, update) => {
  const url = ftsUrl()!;
  const cache = readFts(url);
  const seed = new Map(ids.filter(id => cache.counts[id] > 0).map(id => [id, cache.counts[id]]));
  const todo = ids.filter(id => !(id in cache.counts));
  await pool(todo, 3, async id => {
    const byPatient = await searchCohortNotes(id).catch(() => searchCohortNotes(id));
    const n = byPatient.get(id)?.length ?? 0;
    cache.counts[id] = n;
    try { sessionStorage.setItem(FTS_KEY, JSON.stringify(cache)); } catch { /* ignore */ }
    return n || null;
  }, update, seed);
};

export const useGenomicsCoverage = (ids: string[]) => useCoverage(ids, genomicsLoad);
/** Only checked once `enabled` (the column is hidden by default, and each check is a slow call). */
export const useNotesIndexed = (ids: string[], enabled: boolean) => useCoverage(ids, ftsUrl() ? ftsLoad : null, enabled);
