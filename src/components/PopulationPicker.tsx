import { useState } from 'react';
import { Alert, Button, Dialog } from 'clinical-primitives';
import { cubeFor, useOutcomeCube } from '../outcomes/cube';
import {
  DEFAULT_TABLE, addPopulation, allPopulations, removePopulation, selectPopulation, usePopulation,
} from '../outcomes/population';

/** Population cube for the Therapy outcomes section: switch, add, or remove. */
export function PopulationPicker({ compact = false }: { compact?: boolean }) {
  const pop = usePopulation();
  const { cube, error } = useOutcomeCube();
  const [adding, setAdding] = useState(false);
  const options = allPopulations();

  return (
    <div className="endpoint-picker">
      {compact
        ? <label className="sr-only" htmlFor="population-select">Outcomes population</label>
        : <label className="muted-label" htmlFor="population-select">Outcomes population</label>}
      <select
        id="population-select"
        className="endpoint-select"
        value={pop.id}
        onChange={e => selectPopulation(e.target.value)}
        title={pop.api ? `${pop.api}/cube?tables=${pop.table}` : pop.file}
      >
        {options.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
      </select>
      <Button variant="muted" onClick={() => setAdding(true)}>Add…</Button>
      {!pop.builtin && <Button variant="muted" onClick={() => removePopulation(pop.id)}>Remove</Button>}
      {!compact && (
        <span className="muted population-status">
          {error ? <span className="text-danger">Could not load: {error}</span>
            : cube ? `${cube.total.toLocaleString()} synthetic children in this population${cube.source.includes('unavailable') ? ' · API unavailable, using the bundled copy' : ''}`
            : 'Loading…'}
        </span>
      )}
      {compact && error && <Alert variant="danger">Could not load this population: {error}</Alert>}
      {adding && <AddPopulationDialog onClose={() => setAdding(false)} />}
    </div>
  );
}

function AddPopulationDialog({ onClose }: { onClose: () => void }) {
  const [api, setApi] = useState('');
  const [table, setTable] = useState(DEFAULT_TABLE);
  const [label, setLabel] = useState('');
  const [status, setStatus] = useState<{ ok: boolean; msg: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const base = api.trim().replace(/\/+$/, '').replace(/\/(cube|details)(\?.*)?$/, '');

  const test = async () => {
    setBusy(true);
    setStatus(null);
    try {
      const cube = await cubeFor({ id: 'test', label: 'test', api: base, table: table.trim() });
      setStatus({ ok: true, msg: `Loaded ${cube.rows.toLocaleString()} cells covering ${cube.total.toLocaleString()} patients.` });
      return true;
    } catch (e) {
      const msg = e instanceof TypeError
        ? 'Could not reach it from the browser (network error, or the server does not allow this site via CORS).'
        : (e as Error).message;
      setStatus({ ok: false, msg });
      return false;
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onClose={onClose} title="Add outcomes population" style={{ width: 'min(600px, 92vw)' }}>
      <div className="section-settings">
        <label className="field">
          <span className="muted-label">Study API cohort URL</span>
          <input className="search-input" autoFocus value={api} placeholder="https://host/path/study/<study>/cohort/<cohort>"
            onChange={e => { setApi(e.target.value); setStatus(null); }} />
          <span className="muted">The part before <code>/cube</code> or <code>/details</code>.</span>
        </label>
        <label className="field">
          <span className="muted-label">Cube table</span>
          <input className="search-input" value={table} onChange={e => { setTable(e.target.value); setStatus(null); }} />
          <span className="muted">
            Needs the event-free survival cube's columns: survival years, status, age at diagnosis, first-line
            therapy, gender, subtype, severity, perianal disease and <code>cnt</code>.
          </span>
        </label>
        <label className="field">
          <span className="muted-label">Name (optional)</span>
          <input className="search-input" value={label} onChange={e => setLabel(e.target.value)} />
        </label>
        {status && <Alert variant={status.ok ? 'success' : 'danger'}>{status.msg}</Alert>}
      </div>
      <div className="section-settings-foot endpoint-dialog-foot">
        <Button variant="muted" disabled={!base || !table || busy} onClick={test}>Test</Button>
        <Button variant="info" disabled={!base || !table || busy}
          onClick={async () => { if (await test()) { addPopulation(base, table, label); onClose(); } }}>
          Save and switch
        </Button>
      </div>
    </Dialog>
  );
}
