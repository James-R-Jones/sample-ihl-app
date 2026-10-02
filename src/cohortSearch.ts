import { useCallback, useEffect, useMemo, useState } from 'react';
import { getPatientResources, groupByType } from './api';
import { buildIndex, search, type IndexedResource, type SearchResult } from './search';

type Status = 'loading' | 'ready' | 'error';
export interface Entry { status: Status; index?: IndexedResource[] }

const CONCURRENCY = 3;

// Module-level, so going into a patient and back to the list keeps the
// indexed records (the raw records are cached in api.ts as well).
const entries = new Map<string, Entry>();
const listeners = new Set<() => void>();
const emit = () => listeners.forEach(l => l());

function load(ids: string[]) {
  const queue = ids.filter(id => !entries.has(id) || entries.get(id)!.status === 'error');
  if (!queue.length) return;
  queue.forEach(id => entries.set(id, { status: 'loading' }));
  emit();
  const worker = async () => {
    for (let id = queue.shift(); id; id = queue.shift()) {
      try {
        entries.set(id, { status: 'ready', index: buildIndex(groupByType(await getPatientResources(id))) });
      } catch {
        entries.set(id, { status: 'error' });
      }
      emit();
    }
  };
  Array.from({ length: CONCURRENCY }, worker);
}

/**
 * Loads and indexes every listed patient's record, a few at a time, starting
 * the first time `enabled` is true. Records come from the shared cache in
 * api.ts, so a patient opened afterwards does not fetch again.
 */
export function useCohortIndex(patientIds: string[], enabled: boolean) {
  const [, setTick] = useState(0);
  useEffect(() => {
    const l = () => setTick(t => t + 1);
    listeners.add(l);
    return () => { listeners.delete(l); };
  }, []);

  useEffect(() => { if (enabled) load(patientIds); }, [enabled, patientIds]);

  const retry = useCallback(() => load(patientIds), [patientIds]);
  const mine = patientIds.map(id => [id, entries.get(id)] as const);
  return {
    entries: Object.fromEntries(mine.filter(([, e]) => e)) as Record<string, Entry>,
    loaded: mine.filter(([, e]) => e?.status === 'ready').length,
    failed: mine.filter(([, e]) => e?.status === 'error').length,
    total: patientIds.length,
    retry,
  };
}

/** Per-patient results for a query, over whichever records are indexed so far. */
export function useCohortResults(entryMap: Record<string, Entry>, terms: string[], loaded: number) {
  return useMemo(() => {
    const out = new Map<string, SearchResult[]>();
    if (!terms.length) return out;
    for (const [id, e] of Object.entries(entryMap)) {
      if (e.index) out.set(id, search(e.index, terms));
    }
    return out;
    // `loaded` changes whenever another record finishes indexing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [terms, loaded]);
}
