/**
 * Full-text search over one patient's loaded record. Every string value in
 * every resource is indexed with its path, plus the decoded text of inline
 * note attachments (DocumentReference content, DiagnosticReport presentedForm).
 */
import { attachmentText, summarize } from './encounter';

type Res = { resourceType: string; id?: string; [k: string]: any };

export interface Field { path: string; text: string; lower: string }
export interface IndexedResource { resource: Res; fields: Field[] }

/** Keys whose values are identifiers, URLs, base64 or markup rather than readable text. */
const SKIP_KEYS = new Set(['id', 'reference', 'system', 'url', 'fullUrl', 'profile', 'data', 'div', 'meta', 'hash']);

const LABEL_FIELD = 'note';

export function buildIndex(resources: Record<string, unknown[]>): IndexedResource[] {
  const out: IndexedResource[] = [];
  for (const list of Object.values(resources)) {
    for (const resource of list as Res[]) {
      const fields: Field[] = [];
      const add = (path: string, text: string) => {
        if (text.trim()) fields.push({ path, text, lower: text.toLowerCase() });
      };
      const walk = (v: unknown, path: string, key: string) => {
        if (SKIP_KEYS.has(key)) return;
        if (typeof v === 'string') add(path, v);
        else if (typeof v === 'number') add(path, String(v));
        else if (Array.isArray(v)) v.forEach(x => walk(x, path, key));
        else if (v && typeof v === 'object') {
          for (const [k, x] of Object.entries(v)) walk(x, path ? `${path}.${k}` : k, k);
        }
      };
      walk(resource, '', '');
      const attachments = [
        ...(resource.content ?? []).map((c: Res) => c.attachment),
        ...(resource.presentedForm ?? []),
      ].filter(Boolean);
      for (const a of attachments) {
        const t = attachmentText(a);
        if (t) add(LABEL_FIELD, t);
      }
      out.push({ resource, fields });
    }
  }
  return out;
}

/**
 * Splits a query into lowercase terms. "Quoted phrases" stay together; every
 * term must appear somewhere in a resource for it to match.
 */
export function parseQuery(q: string): string[] {
  const terms: string[] = [];
  const re = /"([^"]+)"|(\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(q))) terms.push((m[1] ?? m[2]).toLowerCase());
  return terms.filter(t => t.length > 0);
}

export interface Hit { field: Field; terms: string[] }
export interface SearchResult {
  resource: Res;
  hits: Hit[];
  title: string;
  detail?: string;
  date?: string;
  /** Matched in decoded note text. */
  inNote: boolean;
}

export function search(index: IndexedResource[], terms: string[]): SearchResult[] {
  if (!terms.length) return [];
  const results: SearchResult[] = [];
  for (const { resource, fields } of index) {
    const hits: Hit[] = [];
    const found = new Set<string>();
    const seen = new Set<string>();
    for (const field of fields) {
      const fieldTerms = terms.filter(t => field.lower.includes(t));
      // CodeableConcepts repeat the same words in .text and .coding.display.
      if (fieldTerms.length && !seen.has(field.lower)) {
        seen.add(field.lower);
        hits.push({ field, terms: fieldTerms });
        fieldTerms.forEach(t => found.add(t));
      }
    }
    if (found.size === terms.length) {
      const s = summarize(resource);
      results.push({ resource, hits, ...s, inNote: hits.some(h => h.field.path === LABEL_FIELD) });
    }
  }
  // Newest first; undated last.
  return results.sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''));
}

/** A window of text around the first match, for result lists. */
export function snippet(text: string, terms: string[], radius = 70): string {
  const lower = text.toLowerCase();
  const at = Math.min(...terms.map(t => lower.indexOf(t)).filter(i => i >= 0));
  if (!Number.isFinite(at)) return text.slice(0, radius * 2);
  const start = Math.max(0, at - radius);
  const end = Math.min(text.length, at + radius);
  return `${start > 0 ? '…' : ''}${text.slice(start, end).replace(/\s+/g, ' ').trim()}${end < text.length ? '…' : ''}`;
}

/** Human label for a field path like "code.coding.display". */
const NOISE = new Set(['coding', 'display', 'text', 'valueString', 'detail', 'concept']);

export function fieldLabel(path: string): string {
  if (path === LABEL_FIELD) return 'Note text';
  const parts = path.split('.');
  const kept = parts.filter(p => !NOISE.has(p));
  const words = (kept.length ? kept : parts.slice(0, 1))
    .map(p => p.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase());
  const label = words.join(' › ');
  return label.charAt(0).toUpperCase() + label.slice(1);
}

/** Earliest and most recent dated results (by their own date). */
export function firstAndLast(results: SearchResult[]): { first?: SearchResult; last?: SearchResult } {
  const dated = results.filter(r => r.date).sort((a, b) => a.date!.localeCompare(b.date!));
  return { first: dated[0], last: dated[dated.length - 1] };
}

/** Results for the same thing (same type and title), e.g. every infliximab order. */
export interface HitGroup {
  key: string;
  type: string;
  title: string;
  results: SearchResult[];
  first?: SearchResult;
  last?: SearchResult;
}

/** Groups results by type and title; most recently seen groups first, undated last. */
export function groupResults(results: SearchResult[]): HitGroup[] {
  const groups = new Map<string, HitGroup>();
  for (const r of results) {
    const key = `${r.resource.resourceType}|${r.title.toLowerCase()}`;
    const g = groups.get(key) ?? { key, type: r.resource.resourceType, title: r.title, results: [] };
    g.results.push(r);
    groups.set(key, g);
  }
  return [...groups.values()]
    .map(g => ({ ...g, ...firstAndLast(g.results) }))
    .sort((a, b) => (b.last?.date ?? '').localeCompare(a.last?.date ?? '') || b.results.length - a.results.length);
}
