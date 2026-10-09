/**
 * Data sources the app can read from. Each is a cohort on a server that speaks
 * the smart-on-fhir/fhir-rest-api protocol. Servers differ in two details, so
 * those are per endpoint:
 *  - jsonContentType: send `Content-Type: application/json`. Required by the
 *    FastAPI server (it ignores the body otherwise); the AWS API Gateway
 *    deployment's CORS preflight rejected it.
 *  - trailingSlash: `/condition/?…` (AWS) vs `/condition?…` (FastAPI, where a
 *    trailing slash redirects and fails in the browser).
 *
 * The active endpoint is chosen once at page load, from `?endpoint=` in the
 * page URL, else the last one picked in this browser, else the default.
 * Switching reloads the page so no cached data from another source survives.
 */
export interface Endpoint {
  id: string;
  label: string;
  /** Base URL including the cohort, e.g. https://host/synthetic/fhir/sim-ibd-patients */
  url: string;
  jsonContentType: boolean;
  trailingSlash: boolean;
  builtin?: boolean;
}

const fromEnv = import.meta.env.VITE_FHIR_API_BASE as string | undefined;

export const BUILTIN_ENDPOINTS: Endpoint[] = [
  ...(fromEnv ? [{
    id: 'env', label: 'Configured (.env)', url: fromEnv, jsonContentType: true, trailingSlash: false, builtin: true,
  }] : []),
  {
    id: 'smartcumulus-ibd-v2',
    label: 'SMART Cumulus · Synthetic IBD v2',
    url: 'https://www.smartcumulus.org/synthetic/fhir/cumulus_sim_ibd_v2',
    jsonContentType: true,
    trailingSlash: false,
    builtin: true,
  },
  {
    id: 'smartcumulus-ibd',
    label: 'SMART Cumulus · Synthetic IBD',
    url: 'https://www.smartcumulus.org/synthetic/fhir/sim-ibd-patients',
    jsonContentType: true,
    trailingSlash: false,
    builtin: true,
  },
  {
    id: 'aws-test-ibd',
    label: 'AWS test · Synthetic IBD',
    url: 'https://04sdlmjrsh.execute-api.us-east-1.amazonaws.com/test/fhir/sim-ibd-patients',
    jsonContentType: false,
    trailingSlash: true,
    builtin: true,
  },
];

const CUSTOM_KEY = 'ihl-patient-app.endpoints.custom';
const SELECTED_KEY = 'ihl-patient-app.endpoints.selected';
const PARAM = 'endpoint';
/** For a link to an unsaved endpoint: `style=aws` means no JSON content type, trailing slash. */
const STYLE_PARAM = 'style';

const read = <T,>(key: string, fallback: T): T => {
  try { return JSON.parse(localStorage.getItem(key) ?? 'null') ?? fallback; } catch { return fallback; }
};
const write = (key: string, value: unknown) => {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* ignore */ }
};

export const normalizeUrl = (u: string) => u.trim().replace(/\/+$/, '');

export function customEndpoints(): Endpoint[] {
  return read<Endpoint[]>(CUSTOM_KEY, []);
}

export function allEndpoints(): Endpoint[] {
  // A custom endpoint saved before its URL became a built-in is listed once, as the built-in.
  const builtinUrls = new Set(BUILTIN_ENDPOINTS.map(e => e.url));
  return [...BUILTIN_ENDPOINTS, ...customEndpoints().filter(e => !builtinUrls.has(e.url))];
}

export function saveCustomEndpoint(e: Omit<Endpoint, 'id' | 'builtin'>): Endpoint {
  const saved: Endpoint = { ...e, url: normalizeUrl(e.url), id: `custom-${Date.now().toString(36)}` };
  write(CUSTOM_KEY, [...customEndpoints(), saved]);
  return saved;
}

export function removeCustomEndpoint(id: string) {
  write(CUSTOM_KEY, customEndpoints().filter(e => e.id !== id));
}

/** The endpoint for this page load. */
function resolveActive(): Endpoint {
  const all = allEndpoints();
  const param = new URLSearchParams(window.location.search).get(PARAM);
  if (param) {
    const byId = all.find(e => e.id === param);
    if (byId) return byId;
    // A shared link may carry a URL this browser has never saved.
    if (/^https?:\/\//.test(param)) {
      const url = normalizeUrl(param);
      const aws = new URLSearchParams(window.location.search).get(STYLE_PARAM) === 'aws';
      return all.find(e => e.url === url)
        ?? { id: `link-${url}`, label: `${new URL(url).host} (shared link)`, url, jsonContentType: !aws, trailingSlash: aws };
    }
  }
  const selected = read<string | null>(SELECTED_KEY, null);
  return all.find(e => e.id === selected) ?? all[0];
}

export const ACTIVE_ENDPOINT: Endpoint = resolveActive();

/** Switch data source: remember it, put it in the URL, and reload at the patient list. */
export function selectEndpoint(e: Endpoint) {
  write(SELECTED_KEY, e.id);
  const url = new URL(window.location.href);
  // Built-ins by id; anything else by URL (plus its style) so the link works
  // in a browser that has not saved it.
  url.searchParams.set(PARAM, e.builtin ? e.id : e.url);
  if (!e.builtin && !e.jsonContentType) url.searchParams.set(STYLE_PARAM, 'aws');
  else url.searchParams.delete(STYLE_PARAM);
  url.hash = '#/';
  window.location.assign(url.toString());
}

/**
 * Checks that a URL answers like a cohort endpoint: GET /resources returns a
 * list of types, and a Patient list call works with the given settings.
 */
export async function probeEndpoint(e: Pick<Endpoint, 'url' | 'jsonContentType' | 'trailingSlash'>) {
  const base = normalizeUrl(e.url);
  const types = await fetch(`${base}/resources`).then(r => {
    if (!r.ok) throw new Error(`GET /resources returned ${r.status}`);
    return r.json() as Promise<string[]>;
  });
  if (!Array.isArray(types)) throw new Error('GET /resources did not return a list of resource types');
  if (types.length === 0) throw new Error('The server answered, but this cohort has no resources. Check the cohort name at the end of the URL.');
  const res = await fetch(`${base}/patient${e.trailingSlash ? '/' : ''}?offset=0&limit=1`, {
    method: 'POST',
    headers: e.jsonContentType ? { 'Content-Type': 'application/json' } : undefined,
    body: '{}',
  });
  if (!res.ok) throw new Error(`Patient list returned ${res.status}`);
  const body = await res.json();
  return { types, patients: body?.pagination?.total as number | undefined };
}
