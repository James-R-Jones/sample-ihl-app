/**
 * The patient's study variables from sds-study-variables: the Cumulus IBD
 * study's summary fields, Paris classification, therapy lines and disease
 * activity (src/studyVariables.ts).
 */
import { Alert, Badge, Loader } from 'clinical-primitives';
import { useStudyPatient, STUDY_VERSION, type Row, type StudyPatient, type SummaryField } from '../studyVariables';
import type { SectionConfigs } from '../settings';

type Config = SectionConfigs['study'];

const fmtDay = (s: string) => new Date(s).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' });
const isDay = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);

/** Codes such as NOT_ASSESSED or PERIANAL_CROHNS_SURGERY as words. */
function words(v: string) {
  if (!/^[A-Z0-9_]+$/.test(v) || /^(CD|UC|IBDU|[ABLESGP]\d[\w]*)$/.test(v)) return v;
  const s = v.toLowerCase().replace(/_/g, ' ')
    .replace(/\bfhir\b/g, 'FHIR').replace(/\bnlp\b/g, 'NLP').replace(/\bibd\b/g, 'IBD').replace(/\bcrohns\b/g, "Crohn's");
  return s[0].toUpperCase() + s.slice(1);
}

function show(v: unknown): string {
  if (v == null || v === '') return '—';
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  if (isDay(v)) return fmtDay(v);
  if (typeof v === 'number') return v.toLocaleString();
  return words(String(v));
}

const KEY_LABELS: Record<string, string> = {
  note_author_date: 'Note date', score_date: 'Date', event_date: 'Date', sescd_total: 'SES-CD',
  pcdai_total: 'PCDAI', activity_index: 'Index', abdominal_pain: 'Pain', nocturnal_stools: 'Nocturnal stools',
  stools_per_day: 'Stools per day', steroid_exposed_bool: 'Exposed', first_steroid_date: 'First',
  last_steroid_date: 'Last', prior_surgery_bool: 'Prior surgery', first_qualifying_surgery_date: 'First surgery',
  first_qualifying_surgery_type: 'Type', paris_cd_perianal_ever: 'Ever', latest_coded_perianal_date: 'Latest coded',
};
const keyLabel = (k: string) => KEY_LABELS[k] ?? words(k.replace(/_bool$/, '').toUpperCase());

function FieldValue({ f }: { f: SummaryField }) {
  const v = f.value;
  if (v == null) return <span className="muted">Not documented</span>;
  if (typeof v !== 'object') return <b>{f.type === 'day' && isDay(v) ? fmtDay(v) : show(v)}</b>;
  const entries = Object.entries(v as Record<string, unknown>).filter(([, x]) => x != null && x !== '');
  if (!entries.length) return <span className="muted">Not documented</span>;
  return (
    <dl className="study-kv">
      {entries.map(([k, x]) => (
        <div key={k}><dt>{keyLabel(k)}</dt><dd>{show(x)}</dd></div>
      ))}
    </dl>
  );
}

function SourceBadge({ refs }: { refs: string[] }) {
  if (!refs.length) return null;
  const notes = refs.filter(r => r.startsWith('DocumentReference/')).length;
  const label = notes === refs.length ? `${notes} note${notes === 1 ? '' : 's'}` : `${refs.length} source${refs.length === 1 ? '' : 's'}`;
  return (
    <span className="study-sources" data-tooltip="Evidence the study used. Its references are hashed ids, so they can't be opened in this record.">
      <Badge variant="muted">{label}</Badge>
    </span>
  );
}

function Fields({ data }: { data: StudyPatient }) {
  const groups = new Map<string, [string, SummaryField][]>();
  for (const [k, f] of Object.entries(data.fields)) groups.set(f.category, [...(groups.get(f.category) ?? []), [k, f]]);
  return (
    <>
      {[...groups].map(([cat, fields]) => (
        <div key={cat} className="study-group">
          <h4 className="muted-label">{cat}</h4>
          <div className="study-grid">
            {fields.map(([k, f]) => (
              <div key={k} className="study-field" data-tooltip={[f.description, f.details?.trim()].filter(Boolean).join(' ') || undefined}>
                <div className="study-field-head"><span>{f.label}</span><SourceBadge refs={f.source_refs} /></div>
                <FieldValue f={f} />
              </div>
            ))}
          </div>
        </div>
      ))}
    </>
  );
}

const PARIS_ROWS: [string, string, (r: Row) => boolean][] = [
  ['Age group', 'paris_age_group', () => true],
  ['Location', 'paris_cd_location', r => r.ibd_diagnosis_subtype_best === 'CD'],
  ['Upper GI (L4a)', 'paris_cd_l4a', r => r.ibd_diagnosis_subtype_best === 'CD'],
  ['Upper GI (L4b)', 'paris_cd_l4b', r => r.ibd_diagnosis_subtype_best === 'CD'],
  ['Behavior', 'paris_cd_behavior', r => r.ibd_diagnosis_subtype_best === 'CD'],
  ['Perianal disease', 'paris_cd_perianal', r => r.ibd_diagnosis_subtype_best === 'CD'],
  ['Extent', 'paris_uc_extent', r => r.ibd_diagnosis_subtype_best !== 'CD'],
  ['Severity', 'paris_uc_severity', r => r.ibd_diagnosis_subtype_best !== 'CD'],
  ['Growth', 'paris_growth', () => true],
];

function Paris({ r }: { r: Row }) {
  const rows = PARIS_ROWS.filter(([, , applies]) => applies(r));
  return (
    <div className="study-group">
      <h4 className="muted-label">Paris classification</h4>
      <div className="outcome-table-wrap">
        <table className="outcome-table study-table">
          <thead><tr><th /><th>At baseline</th><th>Ever</th></tr></thead>
          <tbody>
            {rows.map(([label, key]) => {
              const base = key === 'paris_age_group' ? r.paris_age_group : r[`${key}_baseline`];
              const ever = key === 'paris_age_group' ? null : r[`${key}_ever`];
              return <tr key={key}><td>{label}</td><td>{show(base)}</td><td>{key === 'paris_age_group' ? '' : show(ever)}</td></tr>;
            })}
          </tbody>
        </table>
      </div>
      <p className="muted study-foot">
        Diagnosed {show(r.ibd_diagnosis_date_best)} at {show(r.age_at_diagnosis_years)} years
        (method: {words(String(r.age_at_diagnosis_method ?? 'unknown').toUpperCase()).replace(/^FHIR/, 'FHIR')}).
        {r.care_entry_date ? ` Care here from ${show(r.care_entry_date)}.` : ''}
      </p>
    </div>
  );
}

const CLASS_LABEL: Record<string, string> = {
  JAK_INHIBITOR: 'JAK inhibitor', ANTI_INTERLEUKIN: 'Anti-interleukin', ANTI_INTEGRIN: 'Anti-integrin',
  ANTI_TNF: 'Anti-TNF', IMMUNOMODULATOR: 'Immunomodulator', AMINOSALICYLATE: '5-ASA',
};

function TherapyLines({ data }: { data: StudyPatient }) {
  const lines = [...data.therapyLines].sort((a, b) => Number(a.therapy_line_number) - Number(b.therapy_line_number));
  if (!lines.length) return null;
  return (
    <div className="study-group">
      <h4 className="muted-label">Therapy lines</h4>
      <div className="outcome-table-wrap">
        <table className="outcome-table study-table">
          <thead><tr><th>Line</th><th>Drug classes</th><th>Started</th><th>Strategy</th><th>Outcome</th></tr></thead>
          <tbody>
            {lines.map(l => {
              const n = Number(l.therapy_line_number);
              const classes = data.therapyClasses.filter(c => Number(c.therapy_line_number) === n);
              return (
                <tr key={n}>
                  <td>{n}</td>
                  <td>
                    {classes.map(c => (
                      <span key={String(c.rx_class)} className="study-class">
                        {CLASS_LABEL[String(c.rx_class)] ?? show(c.rx_class)}
                        {c.class_failure_bool ? <Badge variant="warning" title={`${show(c.class_failure_reason)}, ${show(c.class_failure_date)}`}>failed</Badge> : null}
                      </span>
                    ))}
                  </td>
                  <td>{show(l.line_start_date)}</td>
                  <td>{show(String(l.rx_strategy ?? '').toUpperCase())}</td>
                  <td>
                    {l.line_failure_bool ? `Failed ${show(l.line_failure_date)}`
                      : l.next_line_start_date ? `Next line ${show(l.next_line_start_date)}` : 'Current'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Activity({ data }: { data: StudyPatient }) {
  const checks = data.outcomes.filter(o => o.variable === 'ibd_activity' && o.outcome_date)
    .sort((a, b) => String(a.outcome_date).localeCompare(String(b.outcome_date)));
  const episodes = data.outcomes.filter(o => o.variable === 'remission_episode')
    .sort((a, b) => String(a.outcome_date).localeCompare(String(b.outcome_date)));
  if (!checks.length && !episodes.length) return null;
  const last = checks[checks.length - 1];
  const remission = checks.filter(c => c.value_text === 'REMISSION').length;
  return (
    <div className="study-group">
      <h4 className="muted-label">Disease activity</h4>
      {checks.length > 0 && (
        <>
          <p>
            {checks.length} clinical assessments, {remission} in remission. Latest: <b>{show(last.value_text)}</b>, {show(last.outcome_date)}.
          </p>
          <div className="study-activity" aria-label="Assessments in date order">
            {checks.map((c, i) => (
              <span key={i} className={`study-dot ${c.value_text === 'REMISSION' ? 'is-remission' : 'is-active'}`}
                data-tooltip={`${show(c.value_text)}, ${show(c.outcome_date)}`} />
            ))}
          </div>
        </>
      )}
      {episodes.length > 0 && (
        <div className="outcome-table-wrap">
          <table className="outcome-table study-table">
            <thead><tr><th>Remission from</th><th>To</th><th className="n">Days</th><th>Later activity</th></tr></thead>
            <tbody>
              {episodes.map((e, i) => (
                <tr key={i}>
                  <td>{show(e.outcome_date)}</td>
                  <td>{show(e.outcome_end_date)}</td>
                  <td className="n">{show(e.value_number)}</td>
                  <td>{e.value_text === 'LATER_ACTIVITY_OBSERVED' ? 'Yes' : e.value_text === 'NO_LATER_ACTIVITY_OBSERVED' ? 'None seen' : show(e.value_text)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export function StudyVariables({ patientId, config }: { patientId: string; config: Config }) {
  const st = useStudyPatient(patientId);
  if (st.status === 'loading') return <Loader msg="Loading study variables (several seconds the first time)…" />;
  if (st.status === 'none') return <p className="muted">{st.reason}. Study variables exist for the SMART Cumulus Synthetic IBD v2 cohort.</p>;
  if (st.status === 'error') return <Alert variant="danger">Could not load study variables: {st.error}</Alert>;
  const { data } = st;
  return (
    <div className="study">
      <p className="muted">
        Computed by the Cumulus IBD study (cumulus-library-ibd-cds, version {STUDY_VERSION}) from this patient's
        coded data and NLP of the notes. Synthetic data.
      </p>
      {config.showSummary && <Fields data={data} />}
      {config.showParis && data.subject && <Paris r={data.subject} />}
      {config.showTherapyLines && <TherapyLines data={data} />}
      {config.showActivity && <Activity data={data} />}
    </div>
  );
}
