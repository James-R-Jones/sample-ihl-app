import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { Button, RadioButton } from 'clinical-primitives';
import { buildIndex, firstAndLast, parseQuery, search, type SearchResult } from '../search';
import { href, replaceHash, type SearchIntent } from '../routes';
import type { SectionConfigs } from '../settings';
import { SearchResultDialog } from './SearchResultDialog';
import { SearchResultsList, resultKey } from './SearchResultsList';
import { SearchGroupsList, fmtDay, groupCount } from './SearchGroupsList';

type Config = SectionConfigs['search'];

/** Search box over every resource in the loaded record, with type filters and a detail dialog. */
export function RecordSearch({ resources, config, patientId, intent }: {
  resources: Record<string, unknown[]>;
  config: Config;
  patientId: string;
  /** Arrived from the patient list's cohort search: run this query, maybe open a result. */
  intent?: SearchIntent;
}) {
  const [query, setQuery] = useState(intent?.q ?? '');
  const [type, setType] = useState<string | null>(null);
  const [limit, setLimit] = useState(config.pageSize);
  const [open, setOpen] = useState<SearchResult | null>(null);
  const [view, setView] = useState<'groups' | 'all'>('groups');
  const rootRef = useRef<HTMLDivElement>(null);

  const index = useMemo(() => {
    const scoped = Object.fromEntries(
      Object.entries(resources).filter(([t]) => !config.excludeTypes.includes(t)),
    );
    return buildIndex(scoped);
  }, [resources, config.excludeTypes]);

  // Typing stays responsive; the search catches up on the deferred value.
  const deferred = useDeferredValue(query);
  const terms = useMemo(() => parseQuery(deferred), [deferred]);
  const all = useMemo(() => {
    const r = search(index, terms);
    return config.notesOnly ? r.filter(x => x.inNote) : r;
  }, [index, terms, config.notesOnly]);

  // Arriving with a search: bring this section into view and open the
  // requested result once (the intent is per navigation, not per render).
  const handled = useRef<string | null>(null);
  useEffect(() => {
    if (!intent?.q) return;
    const key = `${intent.q}|${intent.open ?? ''}`;
    if (handled.current === key) return;
    handled.current = key;
    setQuery(intent.q);
    rootRef.current?.closest('.section')?.scrollIntoView({ block: 'start', behavior: 'smooth' });
    if (intent.open) {
      const hit = search(index, parseQuery(intent.q)).find(r => resultKey(r) === intent.open);
      if (hit) setOpen(hit);
    }
  }, [intent, index]);

  const close = () => {
    setOpen(null);
    // Drop "open" from the URL so a reload doesn't pop the dialog again.
    if (intent?.open) replaceHash(href.patient(patientId, { q: query }));
  };

  const counts = useMemo(() => {
    const c = new Map<string, number>();
    all.forEach(r => c.set(r.resource.resourceType, (c.get(r.resource.resourceType) ?? 0) + 1));
    return [...c.entries()].sort((a, b) => b[1] - a[1]);
  }, [all]);

  const shown = type ? all.filter(r => r.resource.resourceType === type) : all;
  const overall = useMemo(() => firstAndLast(shown), [shown]);

  return (
    <div className="record-search" ref={rootRef}>
      <input
        type="search"
        className="search-input"
        placeholder='Search this record, e.g. infliximab, "abdominal pain", calprotectin'
        value={query}
        onChange={e => { setQuery(e.target.value); setLimit(config.pageSize); setType(null); }}
        aria-label="Search this patient's record"
      />
      <p className="muted search-hint">
        {terms.length === 0
          ? `${index.length.toLocaleString()} resources indexed, including note text. All words must match; use quotes for a phrase.`
          : `${all.length.toLocaleString()} result${all.length === 1 ? '' : 's'}${deferred !== query ? '…' : ''}`}
      </p>

      {counts.length > 1 && (
        <div className="search-filters">
          <button type="button" className={`chip${type === null ? ' chip--on' : ''}`} onClick={() => setType(null)}>
            All <b>{all.length}</b>
          </button>
          {counts.map(([t, n]) => (
            <button key={t} type="button" className={`chip${type === t ? ' chip--on' : ''}`} onClick={() => setType(t === type ? null : t)}>
              {t} <b>{n}</b>
            </button>
          ))}
        </div>
      )}

      {shown.length > 0 && (
        <div className="search-overall">
          {overall.first && (
            <>
              <span className="muted">First match</span>
              <button type="button" className="date-link" onClick={() => setOpen(overall.first!)}>{fmtDay(overall.first.date)}</button>
            </>
          )}
          {overall.last && overall.last !== overall.first && (
            <>
              <span className="muted">Most recent</span>
              <button type="button" className="date-link" onClick={() => setOpen(overall.last!)}>{fmtDay(overall.last.date)}</button>
            </>
          )}
          <div className="app-spacer" />
          <RadioButton
            value={view}
            onChange={v => { setView(v as 'groups' | 'all'); setLimit(config.pageSize); }}
            options={[
              { value: 'groups', label: `By item (${groupCount(shown)})` },
              { value: 'all', label: `All results (${shown.length})` },
            ]}
          />
        </div>
      )}
      {shown.length > 0 && (view === 'groups'
        ? <SearchGroupsList results={shown} terms={terms} onOpen={setOpen} limit={limit} />
        : <SearchResultsList results={shown.slice(0, limit)} terms={terms} onOpen={setOpen} />)}
      {(view === 'groups' ? groupCount(shown) : shown.length) > limit && (
        <Button variant="muted" onClick={() => setLimit(l => l + config.pageSize)}>
          Show more ({((view === 'groups' ? groupCount(shown) : shown.length) - limit).toLocaleString()} remaining)
        </Button>
      )}
      {terms.length > 0 && all.length === 0 && deferred === query && <p className="muted">No matches.</p>}

      {open && <SearchResultDialog result={open} terms={terms} resources={resources} onClose={close} />}
    </div>
  );
}
