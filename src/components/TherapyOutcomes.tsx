/**
 * Therapy outcomes: event-free survival on each first-line therapy among
 * children like this patient, from the synthetic reference cube.
 *
 * The stratifiers start at the patient's own values (outcomes/profile.ts).
 * Each can be switched off or changed; "Widen" finds the nearest selection
 * where at least two therapies have enough data to compare.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Patient } from 'fhir/r4';
import { Alert, Badge, Button, Chart, CheckBox, Loader, RadioButton } from 'clinical-primitives';
import { DIMENSIONS, THERAPIES, type Therapy, useOutcomeCube } from '../outcomes/cube';
import {
  SUBTYPE_CD, evaluate, toStrata, widen, type Evaluation, type RankedTherapy, type Selection, type StratKey,
} from '../outcomes/engine';
import { deriveProfile, type IbdProfile } from '../outcomes/profile';
import type { SectionConfigs } from '../settings';

export type OutcomesConfig = SectionConfigs['outcomes'];
type Use = OutcomesConfig['use'];
type Key = keyof Use;

export const THERAPY_INFO: Record<Therapy, { label: string; color: string; offLabel?: boolean }> = {
  ANTI_TNF:         { label: 'Anti-TNF',          color: 'var(--cp-color-red)' },
  IMMUNOMODULATOR:  { label: 'Immunomodulator',   color: 'var(--cp-color-amber)' },
  AMINOSALICYLATE:  { label: '5-ASA',             color: 'var(--cp-color-teal)' },
  ANTI_INTERLEUKIN: { label: 'Anti-interleukin',  color: 'var(--cp-color-purple)', offLabel: true },
  ANTI_INTEGRIN:    { label: 'Anti-integrin',     color: 'var(--cp-color-green)',  offLabel: true },
  JAK_INHIBITOR:    { label: 'JAK inhibitor',     color: 'var(--cp-color-blue)',   offLabel: true },
};

const LABELS = {
  gender: ['Male', 'Female'],
  subtype: ["Crohn's", 'UC', 'IBD-U'],
  severity: ['Mild', 'Moderate', 'Severe'],
  perianal: ['Yes', 'No'],
};
const STRAT_TITLES: Record<Key, string> = {
  age: 'Age at diagnosis', gender: 'Gender', subtype: 'IBD subtype', severity: 'Severity at presentation', perianal: 'Perianal disease',
};
const WINDOWS = [0, 1, 2, 3, 5];
const HORIZONS = [1, 2, 3, 5];

interface Values { age: number | null; gender: number | null; subtype: number | null; severity: number | null; perianal: number | null }

const fromProfile = (p: IbdProfile): Values => ({
  age: p.age.value, gender: p.gender.value, subtype: p.subtype.value, severity: p.severity.value, perianal: p.perianal.value,
});

const years = (n: number, d = 2) => n.toFixed(d);
const pct = (x: number) => `${Math.round(x * 100)}%`;

export function TherapyOutcomes({ patient, resources, config }: {
  patient: Patient; resources: Record<string, unknown[]>; config: OutcomesConfig;
}) {
  const profile = useMemo(() => deriveProfile(patient, resources), [patient, resources]);
  const { cube, error } = useOutcomeCube();

  const [values, setValues] = useState<Values>(() => fromProfile(profile));
  const [use, setUse] = useState<Use>(config.use);
  const [ageWindow, setAgeWindow] = useState(config.ageWindow);
  const [horizon, setHorizon] = useState(config.horizon);
  const [note, setNote] = useState<string | null>(null);

  const isCD = values.subtype === SUBTYPE_CD;
  const active = (k: Key) => use[k] && values[k] != null && (k !== 'perianal' || (isCD && use.subtype));
  const sel: Selection = {
    age: active('age') ? values.age : null,
    ageWindow: active('age') ? ageWindow : null,
    gender: active('gender') ? values.gender : null,
    subtype: active('subtype') ? values.subtype : null,
    severity: active('severity') ? values.severity : null,
    perianal: active('perianal') ? values.perianal : null,
  };
  const ev = useMemo(() => (cube ? evaluate(cube, toStrata(sel), horizon) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [cube, JSON.stringify(sel), horizon]);

  // On first load, widen like the original picker when the exact match has
  // fewer than two comparable therapies.
  const autoDone = useRef(false);
  useEffect(() => {
    if (!cube || !ev || autoDone.current) return;
    autoDone.current = true;
    if (config.autoWiden && ev.ranked.length < 2) doWiden(true);
  });

  if (error) return <Alert variant="danger">Could not load the outcome cube: {error}</Alert>;
  if (!cube || !ev) return <Loader />;

  const resetToPatient = () => {
    setValues(fromProfile(profile)); setUse(config.use); setAgeWindow(config.ageWindow); setNote(null);
    autoDone.current = false; // widen again, as on opening
  };
  function doWiden(auto = false) {
    if (!cube) return;
    const w = widen(cube, sel, horizon);
    if (!w) { setNote('No wider selection has two therapies to compare.'); return; }
    const next = { ...use };
    for (const k of w.dropped) next[k as StratKey] = false;
    if (sel.age != null && w.sel.ageWindow == null) next.age = false;
    else if (w.sel.ageWindow != null) setAgeWindow(w.sel.ageWindow);
    setUse(next);
    const join = (xs: string[]) => (xs.length > 1 ? `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}` : xs[0]);
    const stopped = [
      ...(sel.age != null && w.sel.ageWindow == null ? ['age'] : []),
      ...w.dropped.map(k => STRAT_TITLES[k].toLowerCase()),
    ];
    const changes = [
      ...(w.sel.ageWindow != null && sel.ageWindow !== w.sel.ageWindow ? [`widened age to ±${w.sel.ageWindow} years`] : []),
      ...(stopped.length ? [`stopped matching on ${join(stopped)}`] : []),
    ];
    setNote(changes.length
      ? `${auto ? 'Too few children match exactly to compare therapies, so the comparison' : 'To compare at least two therapies, the comparison'} ${join(changes)}.`
      : null);
  }

  const control = (k: Key) => {
    const v = values[k];
    const set = (x: number) => { setValues(s => ({ ...s, [k]: x })); setNote(null); };
    if (k === 'age') {
      return (
        <div className="outcome-age">
          <select value={v ?? ''} onChange={e => set(Number(e.target.value))} aria-label="Age at diagnosis">
            {v == null && <option value="">Choose</option>}
            {DIMENSIONS.age_at_initial_diagnosis_years.map(a => <option key={a} value={a}>{a} y</option>)}
          </select>
          <select
            value={ageWindow}
            disabled={!active('age')}
            onChange={e => { setAgeWindow(Number(e.target.value)); setNote(null); }}
            aria-label="Age window"
          >
            {WINDOWS.map(w => <option key={w} value={w}>{w === 0 ? 'Exact age' : `±${w} years`}</option>)}
          </select>
        </div>
      );
    }
    const labels = LABELS[k];
    return (
      <RadioButton
        value={v ?? -1}
        onChange={x => set(Number(x))}
        options={labels.map((l, i) => ({ value: i, label: l, title: k === 'subtype' ? DIMENSIONS.ibd_subtype[i] : undefined }))}
      />
    );
  };

  const derived = (k: Key) => profile[k];
  const overridden = (k: Key) => values[k] !== derived(k).value;

  const strats: Key[] = ['age', 'gender', 'subtype', 'severity', ...(isCD ? ['perianal' as Key] : [])];

  return (
    <div className="outcomes">
      <p className="muted outcomes-intro">
        How long children like this patient stayed free of steroid rescue, escalation or surgery on each
        first-line therapy, in a synthetic reference cohort of {cube.total.toLocaleString()} children with IBD.
      </p>

      <div className="outcome-strata">
        {strats.map(k => {
          const d = derived(k);
          const missing = values[k] == null;
          const blockedPerianal = k === 'perianal' && !use.subtype;
          return (
            <div key={k} className={`outcome-strat${active(k) ? '' : ' off'}`}>
              <label className="setting-row outcome-strat-head">
                <CheckBox
                  checked={use[k]}
                  disabled={blockedPerianal}
                  onChange={e => { const on = e.currentTarget.checked; setUse(u => ({ ...u, [k]: on })); setNote(null); }}
                />
                <span>{STRAT_TITLES[k]}</span>
              </label>
              {control(k)}
              <div className="outcome-source">
                {overridden(k) && d.value != null
                  ? <>Changed from the record. <button type="button" className="linkish" onClick={() => setValues(s => ({ ...s, [k]: d.value }))}>Restore</button></>
                  : missing ? <>{d.source}. Pick a value to use it.</>
                  : d.value == null ? <>Not in the record; set here.</>
                  : blockedPerianal ? <>Needs subtype to be on.</>
                  : d.source}
              </div>
            </div>
          );
        })}
        {!isCD && values.subtype != null && (
          <div className="outcome-strat off">
            <span className="setting-row outcome-strat-head"><span>Perianal disease</span></span>
            <div className="outcome-source">Assessed for Crohn's disease only.</div>
          </div>
        )}
      </div>

      <div className="outcome-bar">
        <span className="muted-label">Outcome window</span>
        <RadioButton
          value={horizon}
          onChange={x => setHorizon(Number(x) as OutcomesConfig['horizon'])}
          options={HORIZONS.map(h => ({ value: h, label: `${h} yr` }))}
        />
        <span className="outcome-n"><b>{ev.n.toLocaleString()}</b> children match</span>
        <span className="outcome-actions">
          <Button variant="muted" onClick={() => doWiden()} disabled={ev.ranked.length >= 2}
            title="Widen the age window or drop stratifiers until two therapies can be compared">Widen to compare</Button>
          <Button variant="muted" onClick={resetToPatient}>Reset to patient</Button>
        </span>
      </div>

      {note && <Alert variant="info">{note}</Alert>}

      {ev.ranked.length < 2 ? (
        <Alert variant="warning">
          {ev.ranked.length === 0
            ? 'No therapy has enough visible patients in this group to estimate. '
            : `Only ${THERAPY_INFO[ev.ranked[0].therapy].label} has enough visible patients here, so there is nothing to compare it with. `}
          Turn a stratifier off, widen the age window, or use Widen to compare.
        </Alert>
      ) : (
        <>
          <Verdict ev={ev} horizon={horizon} />
          <div className="outcome-charts">
            {config.showCurves && <Curves ranked={ev.ranked} />}
            {config.showRanges && <Ranges ranked={ev.ranked} horizon={horizon} />}
          </div>
        </>
      )}

      <OutcomeTable ev={ev} horizon={horizon} firstLine={profile.firstLine} />

      <p className="muted outcome-foot">
        {cube.source}. Life-table (Cutler-Ederer) estimates by whole year; average event-free years are the
        restricted mean over the window. Ranges show the most and least favorable placement of patients hidden
        by small-cell suppression. A therapy is ranked only with at least 30 patients, 30% of them visible.
        Synthetic data: not for clinical decisions.
      </p>
    </div>
  );
}

function Verdict({ ev, horizon }: { ev: Evaluation; horizon: number }) {
  const [top, second] = ev.ranked;
  const a = THERAPY_INFO[top.therapy].label, b = THERAPY_INFO[second.therapy].label;
  const w = `${horizon} year${horizon > 1 ? 's' : ''}`;
  return ev.clear ? (
    <p className="outcome-verdict">
      <b>{a}</b> kept children event-free longest over {w}: <b>{years(top.rmst)}</b> years on average versus {years(second.rmst)} for {b}. The ranges do not overlap.
    </p>
  ) : (
    <p className="outcome-verdict">
      <b>{a}</b> leads on the middle estimate ({years(top.rmst)} versus {years(second.rmst)} years for {b} over {w}), but the ranges overlap, so this group cannot separate them.
    </p>
  );
}

/** Share still event-free by year, using the library chart. */
function Curves({ ranked }: { ranked: RankedTherapy[] }) {
  const data = [0, 1, 2, 3, 4, 5].map(y => ({
    year: String(y),
    ...Object.fromEntries(ranked.map(r => [r.therapy, Math.round(r.S.mid[y] * 1000) / 10])),
  }));
  return (
    <div className="outcome-chart">
      <h4 className="muted-label">Share still event-free (%)</h4>
      <Chart
        type="line"
        data={data}
        xKey="year"
        series={ranked.map(r => ({ key: r.therapy, name: THERAPY_INFO[r.therapy].label, color: THERAPY_INFO[r.therapy].color }))}
        height={260}
        xLabel="Years since diagnosis"
      />
    </div>
  );
}

/** Average event-free years with the range the data allows. */
function Ranges({ ranked, horizon }: { ranked: RankedTherapy[]; horizon: number }) {
  const rowH = 40, W = 520, L = 128, R = 52, T = 6, B = 30;
  const H = T + B + rowH * ranked.length, pw = W - L - R;
  const x = (v: number) => L + pw * v / horizon;
  const step = horizon <= 2 ? 0.5 : 1;
  const ticks: number[] = []; for (let v = 0; v <= horizon + 1e-6; v += step) ticks.push(v);
  return (
    <div className="outcome-chart">
      <h4 className="muted-label">Average event-free years within {horizon} yr</h4>
      <svg viewBox={`0 0 ${W} ${H}`} className="outcome-ranges" role="img" aria-label="Average event-free years with range per therapy; values are in the table">
        {ticks.map(v => (
          <g key={v}>
            <line x1={x(v)} x2={x(v)} y1={T} y2={H - B} className="grid" />
            <text x={x(v)} y={H - B + 16} textAnchor="middle" className="tick">{Number.isInteger(v) ? v : v.toFixed(1)}</text>
          </g>
        ))}
        {ranked.map((r, i) => {
          const cy = T + rowH * i + rowH / 2, c = THERAPY_INFO[r.therapy].color;
          return (
            <g key={r.therapy}>
              <title>{`${THERAPY_INFO[r.therapy].label}: ${years(r.rmst)} years (range ${years(r.lo)} to ${years(r.hi)}), ${r.n.toLocaleString()} patients`}</title>
              <text x={L - 10} y={cy + 4} textAnchor="end" className="name">{THERAPY_INFO[r.therapy].label}</text>
              <line x1={x(Math.min(r.lo, r.rmst))} x2={x(Math.max(r.hi, r.rmst))} y1={cy} y2={cy} style={{ stroke: c }} strokeWidth={8} strokeLinecap="round" opacity={0.35} />
              <circle cx={x(r.rmst)} cy={cy} r={6} style={{ fill: c }} className="dot" />
              <text x={W - R + 8} y={cy + 4} className="value">{years(r.rmst)}</text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function OutcomeTable({ ev, horizon, firstLine }: { ev: Evaluation; horizon: number; firstLine?: IbdProfile['firstLine'] }) {
  const ranked = new Map(ev.ranked.map(r => [r.therapy, r]));
  const order = [...ev.ranked.map(r => r.index), ...ev.rows.filter(r => !ranked.has(r.therapy)).map(r => r.index)];
  return (
    <div className="outcome-table-wrap">
      <table className="outcome-table">
        <thead>
          <tr>
            <th>First-line therapy</th><th className="n">Patients</th><th className="n">Visible</th>
            <th className="n">Avg event-free yrs</th><th className="n">Range</th><th className="n">Event-free at {horizon} yr</th><th>Status</th>
          </tr>
        </thead>
        <tbody>
          {order.map(i => {
            const row = ev.rows[i], q = ranked.get(row.therapy), info = THERAPY_INFO[THERAPIES[i]];
            const status = q ? (q === ev.ranked[0] && ev.ranked.length > 1 ? 'Ranked, top' : 'Ranked')
              : row.reason === 'none' ? 'No patients in this group'
              : row.reason === 'incomplete' ? 'Some age cells too small to show'
              : 'Too few visible patients';
            return (
              <tr key={row.therapy} className={q ? '' : 'unranked'}>
                <td className="outcome-name">
                  <i className="legend-swatch" style={{ background: info.color }} />
                  {info.label}
                  {info.offLabel && <Badge variant="muted">off-label</Badge>}
                  {firstLine?.therapy === row.therapy && (
                    <Badge variant="info" title={`${firstLine.drug}${firstLine.date ? `, ${firstLine.date.slice(0, 10)}` : ''}`}>this patient</Badge>
                  )}
                </td>
                <td className="n">{row.n ? row.n.toLocaleString() : ''}</td>
                <td className="n">{row.n ? `${Math.round(row.visiblePct)}%` : ''}</td>
                <td className="n">{q ? years(q.rmst) : ''}</td>
                <td className="n">{q ? `${years(q.lo)} to ${years(q.hi)}` : ''}</td>
                <td className="n">{q ? pct(q.S.mid[horizon]) : ''}</td>
                <td>{status}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
