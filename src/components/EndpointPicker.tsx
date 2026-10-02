import { useState } from 'react';
import { Alert, Button, CheckBox, Dialog } from 'clinical-primitives';
import { ENDPOINT } from '../config';
import {
  allEndpoints, normalizeUrl, probeEndpoint, removeCustomEndpoint, saveCustomEndpoint, selectEndpoint,
  type Endpoint,
} from '../endpoints';

/** Data source selector for the patient list: switch, add, or remove endpoints. */
export function EndpointPicker() {
  const [list, setList] = useState(allEndpoints);
  const [adding, setAdding] = useState(false);
  const known = list.some(e => e.id === ENDPOINT.id);
  const options = known ? list : [ENDPOINT, ...list];

  return (
    <div className="endpoint-picker">
      <label className="muted-label" htmlFor="endpoint-select">Data source</label>
      <select
        id="endpoint-select"
        className="endpoint-select"
        value={ENDPOINT.id}
        onChange={e => {
          const next = options.find(o => o.id === e.target.value);
          if (next && next.id !== ENDPOINT.id) selectEndpoint(next);
        }}
        title={ENDPOINT.url}
      >
        {options.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
      </select>
      <Button variant="muted" onClick={() => setAdding(true)}>Add…</Button>
      {!ENDPOINT.builtin && known && (
        <Button
          variant="muted"
          onClick={() => {
            removeCustomEndpoint(ENDPOINT.id);
            setList(allEndpoints());
            selectEndpoint(allEndpoints()[0]);
          }}
        >
          Remove
        </Button>
      )}
      {adding && (
        <AddEndpointDialog
          onClose={() => setAdding(false)}
          onSaved={e => { setAdding(false); selectEndpoint(e); }}
        />
      )}
    </div>
  );
}

function AddEndpointDialog({ onClose, onSaved }: { onClose: () => void; onSaved: (e: Endpoint) => void }) {
  const [url, setUrl] = useState('');
  const [label, setLabel] = useState('');
  const [aws, setAws] = useState(false);
  const [status, setStatus] = useState<{ ok: boolean; msg: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const settings = { url, jsonContentType: !aws, trailingSlash: aws };
  const test = async () => {
    setBusy(true);
    setStatus(null);
    try {
      const r = await probeEndpoint(settings);
      setStatus({ ok: true, msg: `Connected: ${r.patients ?? '?'} patients, ${r.types.length} resource types.` });
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
  const save = async () => {
    if (!(await test())) return;
    const host = (() => { try { return new URL(normalizeUrl(url)).host; } catch { return url; } })();
    const cohort = normalizeUrl(url).split('/').pop();
    onSaved(saveCustomEndpoint({ ...settings, label: label.trim() || `${host} · ${cohort}` }));
  };

  return (
    <Dialog open onClose={onClose} title="Add data source" style={{ width: 'min(600px, 92vw)' }}>
      <div className="section-settings">
        <label className="field">
          <span className="muted-label">Cohort URL</span>
          <input
            className="search-input"
            placeholder="https://host/path/fhir/<cohort>"
            value={url}
            onChange={e => { setUrl(e.target.value); setStatus(null); }}
            autoFocus
          />
          <span className="muted">
            The base a <code>smart-on-fhir/fhir-rest-api</code> server serves a cohort at, i.e. the part before
            {' '}<code>/resources</code> or <code>/patient</code>.
          </span>
        </label>
        <label className="field">
          <span className="muted-label">Name (optional)</span>
          <input className="search-input" value={label} onChange={e => setLabel(e.target.value)} placeholder="e.g. Staging · Synthetic IBD" />
        </label>
        <label className="setting-row">
          <CheckBox checked={aws} onChange={e => { setAws(e.currentTarget.checked); setStatus(null); }} />
          AWS API Gateway style (no JSON content type, trailing slash on paths)
        </label>
        {status && <Alert variant={status.ok ? 'success' : 'danger'}>{status.msg}</Alert>}
      </div>
      <div className="section-settings-foot endpoint-dialog-foot">
        <Button variant="muted" disabled={!url || busy} onClick={test}>Test connection</Button>
        <Button variant="info" disabled={!url || busy} onClick={save}>Save and switch</Button>
      </div>
    </Dialog>
  );
}
