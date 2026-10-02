/**
 * Helpers for the encounter view: find everything that points at an
 * encounter, resolve what the encounter points at, and turn any resource into
 * a one-line summary.
 */
import type { Attachment, Encounter, Reference } from 'fhir/r4';
import { lib } from 'clinical-primitives';

type Res = { resourceType: string; id?: string; [k: string]: any };

/** True if any `reference` anywhere inside `value` points at `target` ("Type/id"). */
function refersTo(value: unknown, target: string, id: string): boolean {
  if (Array.isArray(value)) return value.some(v => refersTo(v, target, id));
  if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      if (k === 'reference' && typeof v === 'string'
        && (v === target || v.endsWith(`/${target}`) || v === `urn:uuid:${id}`)) return true;
      if (refersTo(v, target, id)) return true;
    }
  }
  return false;
}

/**
 * Every resource that references the encounter (via `encounter`,
 * `context.encounter`, or any other Reference field), grouped by type.
 */
export function linkedToEncounter(encounterId: string, resources: Record<string, unknown[]>) {
  const target = `Encounter/${encounterId}`;
  const groups: Record<string, Res[]> = {};
  for (const [type, list] of Object.entries(resources)) {
    for (const r of list as Res[]) {
      if (r.resourceType === 'Encounter' && r.id === encounterId) continue;
      if (refersTo(r, target, encounterId)) (groups[type] ??= []).push(r);
    }
  }
  return groups;
}

/** Look a Reference up in the loaded record. */
export function resolve(ref: Reference | undefined, resources: Record<string, unknown[]>): Res | undefined {
  const m = ref?.reference?.match(/([A-Za-z]+)\/([^/]+)$/);
  if (!m) return undefined;
  return (resources[m[1]] as Res[] | undefined)?.find(r => r.id === m[2]);
}

/** Display name for a Practitioner, Location, Organization or Patient. */
export function nameOf(r: Res | undefined, fallback?: string): string {
  if (!r) return fallback ?? '';
  if (typeof r.name === 'string') return r.name;
  const n = r.name?.[0];
  if (n) {
    const clean = (s?: string) => (s ?? '').replace(/\d+$/, '');
    return [n.prefix?.join(' '), ...(n.given ?? []).map(clean), clean(n.family)].filter(Boolean).join(' ');
  }
  return fallback ?? `${r.resourceType}/${r.id}`;
}

/** Who and where: participants, locations and the service provider. */
export function encounterParties(e: Encounter, resources: Record<string, unknown[]>) {
  const label = (ref?: Reference) => nameOf(resolve(ref, resources), ref?.display);
  return {
    practitioners: (e.participant ?? [])
      .map(p => ({ role: p.type?.[0]?.text ?? p.type?.[0]?.coding?.[0]?.display, name: label(p.individual) }))
      .filter(p => p.name),
    locations: (e.location ?? []).map(l => label(l.location)).filter(Boolean),
    provider: label(e.serviceProvider),
  };
}

const text = (cc?: { text?: string; coding?: { display?: string; code?: string }[] }) =>
  cc?.text ?? cc?.coding?.[0]?.display ?? cc?.coding?.[0]?.code;

export const fmtDate = (s?: string) => (s ? new Date(s).toLocaleString(undefined, {
  year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
}) : '');

function quantity(q?: { value?: number; unit?: string; code?: string }) {
  return q?.value == null ? undefined : `${+q.value.toFixed(2)} ${q.unit ?? q.code ?? ''}`.trim();
}

function observationValue(o: Res): string | undefined {
  if (o.valueQuantity) return quantity(o.valueQuantity);
  if (o.valueCodeableConcept) return text(o.valueCodeableConcept);
  if (o.valueString) return o.valueString;
  if (o.component?.length) {
    return o.component.map((c: Res) => `${text(c.code)}: ${quantity(c.valueQuantity) ?? text(c.valueCodeableConcept) ?? ''}`).join('; ');
  }
  return undefined;
}

/** Title, detail line and date for any resource, for list display. */
export function summarize(r: Res): { title: string; detail?: string; date?: string } {
  switch (r.resourceType) {
    case 'Condition':
      return { title: text(r.code) ?? 'Condition', detail: text(r.clinicalStatus), date: r.onsetDateTime ?? r.recordedDate };
    case 'Procedure':
      return { title: text(r.code) ?? 'Procedure', detail: r.status, date: r.performedPeriod?.start ?? r.performedDateTime };
    case 'MedicationRequest':
    case 'MedicationAdministration':
      return {
        title: lib.Medication.getMedicationName(r as any) ?? 'Medication',
        detail: [r.status, r.dosageInstruction?.[0]?.text].filter(Boolean).join(' · '),
        date: r.authoredOn ?? r.effectiveDateTime ?? r.effectivePeriod?.start,
      };
    case 'Observation':
      return { title: text(r.code) ?? 'Observation', detail: observationValue(r), date: r.effectiveDateTime ?? r.issued };
    case 'DiagnosticReport':
      return { title: text(r.code) ?? 'Report', detail: `${r.result?.length ?? 0} results`, date: r.effectiveDateTime ?? r.issued };
    case 'Immunization':
      return { title: text(r.vaccineCode) ?? 'Immunization', detail: r.status, date: r.occurrenceDateTime };
    case 'ImagingStudy': {
      const series = (r.series ?? []).map((s: Res) => [s.modality?.display ?? s.modality?.code, s.bodySite?.display].filter(Boolean).join(' · '));
      return { title: r.description ?? text(r.procedureCode?.[0]) ?? 'Imaging study', detail: series.join('; '), date: r.started };
    }
    case 'CarePlan':
      return {
        title: (r.category ?? []).map(text).filter(Boolean).join(', ') || 'Care plan',
        detail: (r.activity ?? []).map((a: Res) => text(a.detail?.code)).filter(Boolean).join('; '),
        date: r.period?.start,
      };
    case 'CareTeam':
      return {
        title: 'Care team',
        detail: (r.participant ?? []).map((p: Res) => p.member?.display ?? text(p.role?.[0])).filter(Boolean).join('; '),
        date: r.period?.start,
      };
    case 'DocumentReference':
      return { title: text(r.type) ?? 'Document', detail: text(r.category?.[0]), date: r.date };
    case 'Claim':
    case 'ExplanationOfBenefit':
      return { title: r.resourceType, detail: r.status, date: r.created };
    default:
      return { title: text(r.code) ?? r.resourceType, date: r.date ?? r.effectiveDateTime };
  }
}

/** Decode an inline attachment as UTF-8 text, or null if it is not text. */
export function attachmentText(a: Attachment): string | null {
  if (!a.data) return null;
  const type = (a.contentType ?? '').split(';')[0].trim();
  if (!type.startsWith('text/') || type === 'text/html') return null;
  const bytes = Uint8Array.from(atob(a.data), c => c.charCodeAt(0));
  return new TextDecoder('utf-8').decode(bytes);
}
