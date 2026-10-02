import { useDeferredValue, useEffect, useMemo, useState } from 'react';
import { Alert, Badge, Button, CheckBox, DataGrid, Dialog, Loader } from 'clinical-primitives';
import { listAllPatients } from '../api';
import { toRow, type PatientRow } from '../patient';
import { useCohortIndex, useCohortResults } from '../cohortSearch';
import { href, navigate } from '../routes';
import { parseQuery, type SearchResult } from '../search';
import { SearchResultsList, resultKey } from './SearchResultsList';
import { loadVisitSummaries, type VisitInfo, type VisitSummary } from '../visits';

const fmtDay = (iso: string) => new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });

/** Date (linking to the visit) with the visit type and reason underneath. */
function VisitCell({ patientId, visit, loading }: { patientId: string; visit?: VisitInfo; loading: boolean }) {
  if (!visit) return <span className="muted">{loading ? '…' : 'none'}</span>;
  return (
    <span className="visit-cell" data-tooltip={`${visit.label}${visit.reason ? ` · ${visit.reason}` : ''}`}>
      <a className="patient-link" href={href.encounter(patientId, visit.encounterId)}>{fmtDay(visit.date)}</a>
      <span className="visit-cell-detail">{visit.reason ?? visit.label}</span>
    </span>
  );
}

const QUERY_KEY = 'ihl-patient-app.cohortQuery';
const readQuery = () => { try { return sessionStorage.getItem(QUERY_KEY) ?? ''; } catch { return ''; } };
const saveQuery = (q: string) => { try { sessionStorage.setItem(QUERY_KEY, q); } catch { /* ignore */ } };

type SortDir = 'asc' | 'desc';
const PAGE_SIZE = 25;

function compare(a: unknown, b: unknown): number {
  if (a == null || a === '') return 1;
  if (b == null || b === '') return -1;
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return String(a).localeCompare(String(b));
}

export function PatientList({ onOpen }: { onOpen: (id: string) => void }) {
  const [rows, setRows] = useState<PatientRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const [search, setSearch] = useState('');
  const [sortColumn, setSortColumn] = useState('name');
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const [offset, setOffset] = useState(0);
  const [selection, setSelection] = useState<(string | number)[]>([]);

  // Search inside every patient's record (separate from the grid's own
  // search box, which filters on the columns shown).
  const [recordQuery, setRecordQuery] = useState(readQuery);
  const [onlyMatches, setOnlyMatches] = useState(true);
  const [matchesFor, setMatchesFor] = useState<PatientRow | null>(null);
  const deferredQuery = useDeferredValue(recordQuery);
  const terms = useMemo(() => parseQuery(deferredQuery), [deferredQuery]);
  const active = terms.length > 0;
  const ids = useMemo(() => rows.map(r => r.id), [rows]);
  const cohort = useCohortIndex(ids, active);
  const results = useCohortResults(cohort.entries, terms, cohort.loaded);
  useEffect(() => saveQuery(recordQuery), [recordQuery]);

  // Most recent visit / IBD clinic visit per patient (two cohort-wide calls).
  const [visits, setVisits] = useState<Map<string, VisitSummary> | null>(null);
  const [visitsError, setVisitsError] = useState<Error | null>(null);
  useEffect(() => {
    setVisitsError(null);
    loadVisitSummaries(reloadKey > 0).then(setVisits).catch(setVisitsError);
  }, [reloadKey]);

  useEffect(() => {
    const ctrl = new AbortController();
    setLoading(true);
    setError(null);
    listAllPatients(reloadKey > 0)
      .then(ps => setRows(ps.map(toRow)))
      .catch(e => { if (!ctrl.signal.aborted) setError(e); })
      .finally(() => { if (!ctrl.signal.aborted) setLoading(false); });
    return () => ctrl.abort();
  }, [reloadKey]);

  // DataGrid is controlled: filter, sort and page here, hand it the window.
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    let hits = rows.map(r => ({
      ...r,
      lastVisit: visits?.get(r.id)?.last?.date,
      lastIbdVisit: visits?.get(r.id)?.lastIbd?.date,
    }));
    hits = q
      ? hits.filter(r =>
          [r.name, r.mrn, r.id, r.gender, r.location, r.birthDate]
            .some(v => v.toLowerCase().includes(q)))
      : hits;
    if (active) {
      hits = hits.map(r => ({ ...r, matches: results.get(r.id)?.length ?? null }));
      // Patients still loading stay listed until their count is known.
      if (onlyMatches) hits = hits.filter(r => r.matches !== 0);
    }
    const sorted = [...hits].sort((a, b) =>
      compare(a[sortColumn as keyof PatientRow], b[sortColumn as keyof PatientRow]));
    return sortDir === 'desc' ? sorted.reverse() : sorted;
  }, [rows, visits, search, sortColumn, sortDir, active, results, onlyMatches]);

  const page = filtered.slice(offset, offset + PAGE_SIZE);
  const counts = useMemo(() => ({
    female: rows.filter(r => r.gender === 'female').length,
    male: rows.filter(r => r.gender === 'male').length,
  }), [rows]);

  if (loading && !rows.length) return <Loader msg="Loading patients…" centered />;

  return (
    <section className="patient-list">
      <div className="section-head">
        <div>
          <h1>Patients</h1>
          <p className="muted">
            {rows.length} synthetic patients · {counts.female} female · {counts.male} male
          </p>
        </div>
        <div className="section-actions">
          {selection.length > 0 && (
            <>
              <Badge variant="info">{selection.length} selected</Badge>
              <Button variant="muted" onClick={() => setSelection([])}>Clear</Button>
            </>
          )}
          <Button variant="neutral" onClick={() => setReloadKey(k => k + 1)}>Refresh</Button>
        </div>
      </div>

      {error && <Alert variant="danger">Could not load patients: {error.message}</Alert>}
      {visitsError && <Alert variant="warning">Could not load visit dates: {visitsError.message}</Alert>}

      <div className="cohort-search">
        <input
          type="search"
          className="search-input"
          placeholder='Search inside every patient record, e.g. vedolizumab, "perianal fistula"'
          value={recordQuery}
          onChange={e => { setRecordQuery(e.target.value); setOffset(0); }}
          aria-label="Search inside every patient record"
        />
        <div className="cohort-search-status">
          {!active ? (
            <span className="muted">Finds patients whose record mentions your words, including clinical note text. All words must match; quotes keep a phrase.</span>
          ) : (
            <>
              <span>
                <b>{[...results.values()].filter(r => r.length > 0).length}</b> of {cohort.loaded} patient{cohort.loaded === 1 ? '' : 's'} searched have matches
                {cohort.loaded < cohort.total && <span className="muted"> · indexing records {cohort.loaded}/{cohort.total}…</span>}
              </span>
              {cohort.failed > 0 && (
                <span className="cohort-search-failed">
                  {cohort.failed} record{cohort.failed === 1 ? '' : 's'} failed to load{' '}
                  <Button variant="muted" onClick={cohort.retry}>Retry</Button>
                </span>
              )}
              <label className="setting-row">
                <CheckBox checked={onlyMatches} onChange={e => setOnlyMatches(e.currentTarget.checked)} />
                Only patients with matches
              </label>
            </>
          )}
        </div>
      </div>

      <DataGrid
        columns={[
          { propName: 'name', label: 'Name', dataType: 'string', sortProp: 'name',
            renderCell: (r: PatientRow) => (
              <a href={active ? href.patient(r.id, { q: deferredQuery }) : href.patient(r.id)} className="patient-link">
                {r.name}{r.deceased && <span className="muted"> (deceased)</span>}
              </a>
            ) },
          ...(active ? [{
            propName: 'matches', label: 'Matches', dataType: 'number' as const, sortProp: 'matches',
            renderCell: (r: PatientRow & { matches: number | null }) => {
              const st = cohort.entries[r.id]?.status;
              if (st === 'error') return <span className="muted">failed</span>;
              if (r.matches == null) return <span className="muted">…</span>;
              if (r.matches === 0) return <span className="muted">0</span>;
              return (
                <button type="button" className="matches-btn" onClick={() => setMatchesFor(r)}>
                  {r.matches} result{r.matches === 1 ? '' : 's'}
                </button>
              );
            },
          }] : []),
          { propName: 'gender', label: 'Sex', dataType: 'string', sortProp: 'gender' },
          // Some cohorts (e.g. smartcumulus.org) omit birth dates, so both can be empty.
          { propName: 'birthDate', label: 'Birth date', dataType: 'string', sortProp: 'birthDate',
            renderCell: (r: PatientRow) => r.birthDate || <span className="muted">—</span> },
          { propName: 'age', label: 'Age', dataType: 'number', sortProp: 'age',
            renderCell: (r: PatientRow) => (r.age ?? <span className="muted">—</span>) },
          { propName: 'mrn', label: 'MRN', dataType: 'string', sortProp: 'mrn' },
          { propName: 'location', label: 'Location', dataType: 'string', sortProp: 'location' },
          { propName: 'lastVisit', label: 'Last visit', dataType: 'string', sortProp: 'lastVisit',
            renderCell: (r: PatientRow) => <VisitCell patientId={r.id} visit={visits?.get(r.id)?.last} loading={!visits && !visitsError} /> },
          { propName: 'lastIbdVisit', label: 'Last IBD clinic visit', dataType: 'string', sortProp: 'lastIbdVisit',
            renderCell: (r: PatientRow) => <VisitCell patientId={r.id} visit={visits?.get(r.id)?.lastIbd} loading={!visits && !visitsError} /> },
          { propName: 'id', label: 'FHIR id', dataType: 'id', visible: false },
        ]}
        rows={page}
        count={filtered.length}
        offset={offset}
        limit={PAGE_SIZE}
        identity="id"
        selection={selection}
        onSelectionChange={setSelection}
        sortColumn={sortColumn}
        sortDir={sortDir}
        onSortChange={(col, dir) => { setSortColumn(col); setSortDir(dir); setOffset(0); }}
        onPaginationChange={setOffset}
        search={search}
        onSearchChange={s => { setSearch(s); setOffset(0); }}
        loading={loading}
        onNavigate={(row: PatientRow) => (active ? navigate(href.patient(row.id, { q: deferredQuery })) : onOpen(row.id))}
      />

      {matchesFor && (
        <PatientMatchesDialog
          patient={matchesFor}
          query={deferredQuery}
          terms={terms}
          results={results.get(matchesFor.id) ?? []}
          onClose={() => setMatchesFor(null)}
        />
      )}
    </section>
  );
}

/** One patient's matches for the cohort query; each opens in that patient's record search. */
function PatientMatchesDialog({ patient, query, terms, results, onClose }: {
  patient: PatientRow;
  query: string;
  terms: string[];
  results: SearchResult[];
  onClose: () => void;
}) {
  const [limit, setLimit] = useState(25);
  return (
    <Dialog open onClose={onClose} title={`${patient.name}: ${results.length} result${results.length === 1 ? '' : 's'}`} style={{ width: 'min(860px, 94vw)' }}>
      <div className="result-dialog">
        <div className="matches-dialog-head">
          <span className="muted">Matches for <b>{query}</b>. Pick one to open it in this patient's record.</span>
          <Button variant="info" onClick={() => navigate(href.patient(patient.id, { q: query }))}>Open patient with this search</Button>
        </div>
        <SearchResultsList
          results={results.slice(0, limit)}
          terms={terms}
          onOpen={r => navigate(href.patient(patient.id, { q: query, open: resultKey(r) }))}
        />
        {results.length > limit && (
          <Button variant="muted" onClick={() => setLimit(l => l + 25)}>Show more ({results.length - limit} remaining)</Button>
        )}
      </div>
    </Dialog>
  );
}
