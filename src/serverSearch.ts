/**
 * Server-side search through sds-es-fhir: POST {base}/fhirfts/fts/{cohort}.
 *
 * The service matches one keyword as a case-insensitive substring of any
 * string in a resource (ids and codes included) and returns whole resources:
 * - with `patient_id`: every resource type in that patient's record (about 4 s);
 * - without it: only notes (DocumentReference, DiagnosticReport) across the
 *   cohort (about 10 s).
 * `+` in the keyword means OR.
 *
 * The app sends the most selective word of the query and then runs its own
 * matcher (search.ts) over what comes back, so multi-word AND, phrases, type
 * filters and snippets work as in the in-browser search, and matches that hit
 * only ids or codes drop out.
 */
import { useEffect, useState, useSyncExternalStore } from 'react';
import { FHIR_API_BASE } from './config';

type Res = { resourceType: string; id?: string; [k: string]: any };

/** `{origin}/…/fhir/{cohort}` → `{origin}/…/fhirfts/fts/{cohort}`, or null when the base has another shape. */
export function ftsUrl(base = FHIR_API_BASE): string | null {
  const m = base.match(/^(https?:\/\/.+)\/fhir\/([^/]+)$/);
  return m ? `${m[1]}/fhirfts/fts/${m[2]}` : null;
}

/** The longest term: the most selective one to send. Terms with '+' would turn into an OR, so they are skipped. */
export function serverKeyword(terms: string[]): string | null {
  const usable = terms.filter(t => !t.includes('+'));
  return usable.length ? usable.reduce((a, b) => (b.length > a.length ? b : a)) : null;
}

/* ---------- engine choice (per browser) ---------- */

export type Engine = 'server' | 'browser';
const ENGINE_KEY = 'ihl-patient-app.searchEngine';
const engineListeners = new Set<() => void>();
let engine: Engine = (() => { try { return localStorage.getItem(ENGINE_KEY) === 'browser' ? 'browser' : 'server'; } catch { return 'server'; } })();

/** null until tried; false after the endpoint refused (403, 404, 405, or a 500 saying the service is not configured). */
let supported: boolean | null = ftsUrl() ? null : false;

export function setEngine(e: Engine) {
  engine = e;
  try { localStorage.setItem(ENGINE_KEY, e); } catch { /* ignore */ }
  engineListeners.forEach(l => l());
}

/** The chosen engine, whether it is in effect, and why not. */
export function useSearchEngine() {
  const chosen = useSyncExternalStore(
    l => { engineListeners.add(l); return () => engineListeners.delete(l); },
    () => `${engine}|${supported}`,
  );
  const [choice] = chosen.split('|') as [Engine];
  const serverOk = supported !== false;
  return { choice, effective: (choice === 'server' && serverOk ? 'server' : 'browser') as Engine, serverOk, setEngine };
}

/* ---------- requests ---------- */

const cache = new Map<string, Promise<Res[]>>();

async function post(body: object): Promise<Res[]> {
  const url = ftsUrl();
  if (!url || supported === false) throw new Error('Server search is not available for this data source');
  let res: Response;
  try {
    res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  } catch {
    // The service's unhandled errors come back without CORS headers, so the
    // browser reports a network failure instead of the status.
    throw new Error('the server returned an error');
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    if (res.status === 403 || res.status === 404 || res.status === 405 || /no base url configured/i.test(text)) {
      supported = false;
      engineListeners.forEach(l => l());
    }
    throw new Error(`Server search failed (HTTP ${res.status})`);
  }
  const json = await res.json() as { matches?: unknown[] | null };
  if (supported !== true) { supported = true; engineListeners.forEach(l => l()); }
  return ((json.matches ?? []) as unknown[]).flat(2).filter((x): x is Res => !!x && typeof x === 'object' && 'resourceType' in x);
}

function cached(body: object): Promise<Res[]> {
  const key = JSON.stringify(body);
  let p = cache.get(key);
  if (!p) {
    p = post(body);
    p.catch(() => cache.delete(key));
    cache.set(key, p);
  }
  return p;
}

/** Resources in one patient's record that contain the keyword (any type). */
export const searchPatient = (patientId: string, keyword: string) => cached({ keyword, patient_id: patientId });

/** Notes across the cohort that contain the keyword, grouped by patient id. */
export async function searchCohortNotes(keyword: string): Promise<Map<string, Res[]>> {
  const notes = await cached({ keyword });
  const out = new Map<string, Res[]>();
  const seen = new Set<string>();
  for (const n of notes) {
    const key = `${n.resourceType}/${n.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const pid = String(n.subject?.reference ?? '').replace(/^Patient\//, '');
    if (pid) out.set(pid, [...(out.get(pid) ?? []), n]);
  }
  return out;
}

/* ---------- hook: debounced server call ---------- */

export interface ServerState<T> { status: 'idle' | 'loading' | 'ready' | 'error'; data?: T; error?: string; ms?: number; keyword?: string }

/** Runs `run(keyword)` after typing pauses (debounced), keeping the latest result. */
export function useServerQuery<T>(keyword: string | null, enabled: boolean, run: (k: string) => Promise<T>, delay = 500): ServerState<T> {
  const [state, setState] = useState<ServerState<T>>({ status: 'idle' });
  useEffect(() => {
    if (!enabled || !keyword) { setState({ status: 'idle' }); return; }
    let live = true;
    setState(s => ({ ...s, status: 'loading', keyword }));
    const t = setTimeout(() => {
      const t0 = performance.now();
      run(keyword).then(
        data => live && setState({ status: 'ready', data, ms: Math.round(performance.now() - t0), keyword }),
        e => live && setState({ status: 'error', error: String(e?.message ?? e), keyword }),
      );
    }, delay);
    return () => { live = false; clearTimeout(t); };
    // `run` is recreated on render; the keyword and toggle decide when to call.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keyword, enabled]);
  return state;
}
