/**
 * Client for the cohort API described at
 * https://github.com/smart-on-fhir/fhir-rest-api#usage
 *
 * Every data call is a POST with a JSON body. List calls return
 *   { fhir: Resource[], pagination: { total, offset, limit, ... }, otherResources }
 * and the per-patient call returns
 *   { fhir: { [resourceType]: Resource[] } }
 */
import type { FhirResource } from 'clinical-primitives';
import type { Patient } from 'fhir/r4';
import { FHIR_API_BASE } from './config';

export interface Pagination {
  total: number;
  offset: number;
  limit: number;
  count: number;
  next?: string;
}

export interface ListResponse<T> {
  fhir: T[];
  pagination: Pagination;
  otherResources: string[];
}

export interface ListOptions {
  patients?: string[];
  fields?: string[];
  offset?: number;
  limit?: number;
  signal?: AbortSignal;
}

const RETRIES = 3;
const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => { clearTimeout(t); reject(signal.reason); }, { once: true });
  });

/**
 * fetch() with retry and exponential backoff. The API intermittently fails
 * requests (throttling or gateway errors). Those responses carry no CORS
 * headers, so the browser reports them as a network error ("Failed to fetch")
 * rather than a status code; both cases are retried.
 */
async function fetchWithRetry(url: string, init: RequestInit): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(url, init);
      const retryable = res.status === 429 || res.status >= 500;
      if (!retryable || attempt >= RETRIES) return res;
    } catch (e) {
      if (init.signal?.aborted || attempt >= RETRIES) throw e;
    }
    await sleep(400 * 2 ** attempt, init.signal ?? undefined);
  }
}

async function post<T>(path: string, body: object, signal?: AbortSignal): Promise<T> {
  // No Content-Type header on purpose: the API's CORS preflight (OPTIONS)
  // response does not allow it, so a JSON content type makes the browser block
  // the request. Sent as text/plain this is a "simple" request with no
  // preflight, and the API still parses the JSON body.
  const res = await fetchWithRetry(`${FHIR_API_BASE}${path}`, {
    method: 'POST',
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok) {
    throw new Error(`${res.status} ${res.statusText} from POST ${path}`);
  }
  return res.json() as Promise<T>;
}

/** GET /resources: resource types available in the cohort. */
export async function listResourceTypes(signal?: AbortSignal): Promise<string[]> {
  const res = await fetchWithRetry(`${FHIR_API_BASE}/resources`, { signal });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} from GET /resources`);
  return res.json();
}

/** POST /{type}/?offset&limit: one page of a resource type. */
export function listResources<T = FhirResource>(
  resourceType: string,
  { patients, fields, offset = 0, limit = 100, signal }: ListOptions = {},
): Promise<ListResponse<T>> {
  const body: Record<string, unknown> = {};
  if (patients?.length) body.patients = patients;
  if (fields?.length) body.fields = fields;
  const qs = new URLSearchParams({ offset: String(offset), limit: String(limit) });
  return post<ListResponse<T>>(`/${resourceType.toLowerCase()}/?${qs}`, body, signal);
}

/** Pages through a resource type until every record has been fetched. */
export async function listAllResources<T = FhirResource>(
  resourceType: string,
  options: Omit<ListOptions, 'offset'> = {},
): Promise<T[]> {
  const limit = options.limit ?? 100;
  const out: T[] = [];
  for (let offset = 0; ; offset += limit) {
    const page = await listResources<T>(resourceType, { ...options, offset, limit });
    out.push(...page.fhir);
    const total = page.pagination?.total ?? out.length;
    if (page.fhir.length < limit || out.length >= total) break;
  }
  return out;
}

// The per-patient endpoint returns an empty Patient array and the Patient
// list ignores the `patients` filter, so keep the cohort's Patient list cached.
let patientCache: Promise<Patient[]> | null = null;

// The shared request is deliberately not tied to a caller's AbortSignal, so one
// unmounting component cannot cancel it for everyone else.
export function listAllPatients(refresh = false): Promise<Patient[]> {
  if (refresh || !patientCache) {
    patientCache = listAllResources<Patient>('Patient');
    patientCache.catch(() => { patientCache = null; });
  }
  return patientCache;
}

/**
 * POST /patient/{id}: every resource for one patient, flattened into the
 * array shape that clinical-primitives' loadFromResources() expects
 * (exactly one Patient resource).
 */
// Each patient's record is fetched once per session and shared by the
// dashboard and the cohort search. Like the patient list, the shared request
// is not tied to any caller's AbortSignal.
const recordCache = new Map<string, Promise<FhirResource[]>>();

export function getPatientResources(patientId: string, _signal?: AbortSignal): Promise<FhirResource[]> {
  let p = recordCache.get(patientId);
  if (!p) {
    p = fetchPatientResources(patientId);
    p.catch(() => recordCache.delete(patientId));
    recordCache.set(patientId, p);
  }
  return p;
}

/** Resources grouped by resourceType, the shape the search index and views use. */
export function groupByType(resources: FhirResource[]): Record<string, FhirResource[]> {
  const out: Record<string, FhirResource[]> = {};
  for (const r of resources) (out[r.resourceType] ??= []).push(r);
  return out;
}

async function fetchPatientResources(patientId: string): Promise<FhirResource[]> {
  const res = await post<{ fhir: Record<string, FhirResource[]> | FhirResource[] }>(
    `/patient/${encodeURIComponent(patientId)}`,
    {},
  );
  const groups = Array.isArray(res.fhir) ? [res.fhir] : Object.values(res.fhir ?? {});
  const resources = groups.flat().filter((r): r is FhirResource => !!r?.resourceType);

  // Guarantee exactly one Patient so resourcesToPatientDataSet() is happy.
  const others = resolveMedicationReferences(resources.filter(r => r.resourceType !== 'Patient'));
  let patient = resources.find(r => r.resourceType === 'Patient' && r.id === patientId);
  if (!patient) {
    const all = await listAllPatients();
    patient = all.find(p => p.id === patientId) as FhirResource | undefined;
  }
  if (!patient) throw new Error(`Patient ${patientId} not found`);
  return [patient, ...others];
}

/**
 * This cohort's MedicationRequest/MedicationAdministration resources point at
 * a Medication by reference (medicationReference) with no display text, and
 * the library names medications from medicationCodeableConcept or the
 * reference's display only. Copy the referenced Medication's code onto each
 * so every component (lists, timeline, feed) can name it. The reference is
 * kept, so "view source" still shows where it came from.
 */
function resolveMedicationReferences(resources: FhirResource[]): FhirResource[] {
  const meds = new Map<string, any>();
  for (const r of resources) {
    if (r.resourceType === 'Medication' && r.id) meds.set(`Medication/${r.id}`, r);
  }
  return resources.map(r => {
    if (r.resourceType !== 'MedicationRequest' && r.resourceType !== 'MedicationAdministration') return r;
    const x = r as any;
    if (x.medicationCodeableConcept || !x.medicationReference?.reference) return r;
    const med = meds.get(x.medicationReference.reference);
    if (!med?.code) return r;
    const display = med.code.text ?? med.code.coding?.[0]?.display;
    return {
      ...x,
      medicationCodeableConcept: med.code,
      medicationReference: { ...x.medicationReference, display: x.medicationReference.display ?? display },
    } as FhirResource;
  });
}
