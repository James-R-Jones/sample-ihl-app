/**
 * Which patients in the list also have data in the other APIs, for the
 * patient list's check-mark columns.
 *
 * - Genomics: a sample whose subject is the patient (genomics.ts listSamples;
 *   parents' samples are `<id>-M` / `<id>-F` and do not count).
 * - Server search: notes indexed by sds-es-fhir for the patient. One
 *   cohort-wide notes search per patient with the patient id as the keyword,
 *   which matches that patient's notes through their subject reference
 *   (0.4 to 10 s and up to about 1 MB each on 2026-10-12), three at a time.
 *   OR-ing several ids into one call is quicker but some combinations fail
 *   with no CORS headers, so each id goes on its own, retried once. The
 *   answer is kept for the browser session.
 */
import { useEffect, useState } from 'react';
import { listSamples } from './genomics';
import { ftsUrl, searchCohortNotes } from './serverSearch';

export type Coverage = {
  status: 'loading' | 'ready' | 'unsupported' | 'error';
  ids: Set<string>;
  /** Patients that could not be checked. */
  unknown?: Set<string>;
  error?: string;
};
type Result = { found: Set<string>; unknown?: Set<string>; error?: string };
type Loader = (ids: string[], partial: (s: Set<string>) => void) => Promise<Result>;

const CONCURRENCY = 3;
const FTS_KEY = 'ihl-patient-app.ftsIndexed';

type FtsCache = { url: string; checked: string[]; found: string[] };
const readFts = (url: string): FtsCache => {
  try { const c = JSON.parse(sessionStorage.getItem(FTS_KEY) ?? 'null'); if (c?.url === url) return c; } catch { /* ignore */ }
  return { url, checked: [], found: [] };
};
const writeFts = (c: FtsCache) => { try { sessionStorage.setItem(FTS_KEY, JSON.stringify(c)); } catch { /* ignore */ } };

/** Patient ids (of those given) with notes in the server search index. */
async function ftsIndexed(ids: string[], onPartial: (found: Set<string>) => void): Promise<Result> {
  const url = ftsUrl()!;
  const c = readFts(url);
  const found = new Set(c.found);
  const checked = new Set(c.checked);
  const todo = ids.filter(id => !checked.has(id));
  onPartial(new Set(found));
  const unknown = new Set<string>();
  let error = '';
  const check = async (id: string) => {
    try {
      const byPatient = await searchCohortNotes(id).catch(() => searchCohortNotes(id));
      if (byPatient.get(id)?.length) found.add(id);
      checked.add(id);
      writeFts({ url, checked: [...checked], found: [...found] });
      onPartial(new Set(found));
    } catch (e) { unknown.add(id); error = String((e as Error)?.message ?? e); }
  };
  const queue = [...todo];
  await Promise.all(Array.from({ length: CONCURRENCY }, async () => { while (queue.length) await check(queue.shift()!); }));
  if (unknown.size === ids.length) throw new Error(error);
  return { found, unknown, error };
}

function useCoverage(ids: string[], load: Loader | null): Coverage {
  const [state, setState] = useState<Coverage>({ status: load ? 'loading' : 'unsupported', ids: new Set() });
  const key = ids.join(',');
  useEffect(() => {
    if (!load) { setState({ status: 'unsupported', ids: new Set() }); return; }
    if (!ids.length) return;
    let live = true;
    setState(s => ({ ...s, status: 'loading' }));
    load(ids, partial => live && setState({ status: 'loading', ids: partial })).then(
      r => live && setState({ status: 'ready', ids: r.found, unknown: r.unknown, error: r.error }),
      e => live && setState(s => ({ ...s, status: 'error', error: String(e?.message ?? e) })),
    );
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, !!load]);
  return state;
}

const genomicsLoad: Loader = async ids => {
  const subjects = new Set((await listSamples()).map(s => s.subject.replace(/^Patient\//, '')));
  return { found: new Set(ids.filter(id => subjects.has(id))) };
};

export const useGenomicsCoverage = (ids: string[]) => useCoverage(ids, genomicsLoad);
export const useServerSearchCoverage = (ids: string[]) => useCoverage(ids, ftsUrl() ? ftsIndexed : null);
