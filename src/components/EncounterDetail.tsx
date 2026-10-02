import { useMemo, useState, type ReactNode } from 'react';
import type { DiagnosticReport, DocumentReference, Encounter } from 'fhir/r4';
import { AttachmentPreview, Badge, Button, Collapse, SourceDialog } from 'clinical-primitives';
import {
  attachmentText, encounterParties, fmtDate, linkedToEncounter, nameOf, resolve, summarize,
} from '../encounter';
import { classInfo } from '../encounterClasses';
import { NoteText } from './NoteText';

/** Display order for linked resource groups; anything else follows alphabetically. */
const ORDER = [
  'Condition', 'Procedure', 'MedicationRequest', 'MedicationAdministration', 'Observation',
  'DiagnosticReport', 'ImagingStudy', 'Immunization', 'CarePlan', 'CareTeam', 'Device', 'AllergyIntolerance',
];
const PLURAL: Record<string, string> = {
  Condition: 'Conditions', Procedure: 'Procedures', MedicationRequest: 'Medication orders',
  MedicationAdministration: 'Medication administrations', Observation: 'Observations',
  DiagnosticReport: 'Diagnostic reports', ImagingStudy: 'Imaging', Immunization: 'Immunizations',
  CarePlan: 'Care plans', CareTeam: 'Care team', Device: 'Devices', AllergyIntolerance: 'Allergies',
};

type Res = { resourceType: string; id?: string; [k: string]: any };

interface Props {
  encounterId: string;
  resources: Record<string, unknown[]>;
  /** Sidebar layout: tighter, linked groups collapsible. */
  compact?: boolean;
  /** Extra controls next to the title (e.g. "Open as page"). */
  actions?: ReactNode;
  /** Search terms to highlight in note text. */
  highlight?: string[];
}

/**
 * One encounter and everything linked to it: details, clinical notes, and
 * every resource that references it. Used in the timeline sidebar and on the
 * encounter page.
 */
export function EncounterDetail({ encounterId, resources, compact = false, actions, highlight = [] }: Props) {
  const [source, setSource] = useState<Res | null>(null);
  const encounter = ((resources.Encounter ?? []) as Encounter[]).find(e => e.id === encounterId);
  const linked = useMemo(() => linkedToEncounter(encounterId, resources), [encounterId, resources]);

  if (!encounter) return <p className="muted">Encounter {encounterId} is not in this record.</p>;

  const parties = encounterParties(encounter, resources);
  const cls = classInfo(encounter.class?.code);
  const reasons = [
    ...(encounter.reasonCode ?? []).map(r => r.text ?? r.coding?.[0]?.display),
    ...(encounter.reasonReference ?? []).map(r => summarize(resolve(r, resources) ?? { resourceType: '' }).title || r.display),
  ].filter(Boolean);

  const docs = (linked.DocumentReference ?? []) as unknown as DocumentReference[];
  const reports = ((linked.DiagnosticReport ?? []) as unknown as DiagnosticReport[]).filter(d => d.presentedForm?.length);
  const groups = Object.entries(linked)
    .filter(([type]) => type !== 'DocumentReference')
    .sort(([a], [b]) => {
      const ia = ORDER.indexOf(a), ib = ORDER.indexOf(b);
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.localeCompare(b);
    });
  const total = Object.values(linked).reduce((n, l) => n + l.length, 0);

  const renderAttachment = (a: Parameters<typeof attachmentText>[0], key: number) => {
    const t = attachmentText(a);
    return t != null ? <NoteText key={key} text={t} terms={highlight} /> : <AttachmentPreview key={key} attachment={a} />;
  };

  const linkedList = (list: Res[]) => (
    <ul className="linked-list">
      {list.map(r => {
        const s = summarize(r);
        return (
          <li key={r.id}>
            <button type="button" className="linked-item" onClick={() => setSource(r)}>
              <span className="linked-title">{s.title}</span>
              {s.detail && <span className="linked-detail">{s.detail}</span>}
              {s.date && <span className="linked-date">{fmtDate(s.date)}</span>}
            </button>
          </li>
        );
      })}
    </ul>
  );

  return (
    <div className={`encounter-detail${compact ? ' encounter-detail--compact' : ''}`}>
      <div className="encounter-block">
        <div className="encounter-title">
          <h2>{(encounter.type?.[0]?.text ?? encounter.type?.[0]?.coding?.[0]?.display ?? 'Encounter').replace(/ \((procedure|environment|regime\/therapy)\)$/, '')}</h2>
          <Badge variant={encounter.class?.code === 'EMER' ? 'warning' : encounter.class?.code === 'IMP' ? 'danger' : 'neutral'}>{cls.label}</Badge>
          {encounter.status && <Badge variant="muted">{encounter.status}</Badge>}
        </div>
        <div className="encounter-actions">
          <Button variant="muted" onClick={() => setSource(encounter as Res)}>Source</Button>
          {actions}
        </div>
        <dl className="encounter-facts">
          <dt>When</dt>
          <dd>{fmtDate(encounter.period?.start)}{encounter.period?.end ? ` – ${fmtDate(encounter.period.end)}` : ''}</dd>
          {reasons.length > 0 && <><dt>Reason</dt><dd>{reasons.join('; ')}</dd></>}
          {parties.provider && <><dt>Provider</dt><dd>{parties.provider}</dd></>}
          {parties.locations.length > 0 && <><dt>Location</dt><dd>{parties.locations.join('; ')}</dd></>}
          {parties.practitioners.length > 0 && (
            <><dt>Clinicians</dt><dd>{parties.practitioners.map(p => (p.role ? `${p.name} (${p.role})` : p.name)).join('; ')}</dd></>
          )}
          <dt>Linked</dt><dd>{total} record{total === 1 ? '' : 's'}</dd>
        </dl>
      </div>

      <div className="encounter-block">
        <h3 className="encounter-subhead">Clinical notes ({docs.length + reports.length})</h3>
        {docs.length + reports.length === 0 && <p className="muted">No notes are linked to this visit.</p>}
        {docs.map(d => (
          <article key={d.id} className="note">
            <header className="note-head">
              <div>
                <b>{d.type?.text ?? d.type?.coding?.[0]?.display ?? 'Note'}</b>
                {(d.type?.coding?.length ?? 0) > 0 && (
                  <span className="muted"> · {d.type!.coding!.map(c => c.display).filter(Boolean).join(', ')}</span>
                )}
                <div className="muted">
                  {fmtDate(d.date)}
                  {d.author?.length ? ` · ${d.author.map(a => nameOf(resolve(a, resources), a.display)).join(', ')}` : ''}
                </div>
              </div>
              <Button variant="muted" onClick={() => setSource(d as unknown as Res)}>Source</Button>
            </header>
            {(d.content ?? []).map((c, i) => renderAttachment(c.attachment, i))}
          </article>
        ))}
        {reports.map(r => (
          <article key={r.id} className="note">
            <header className="note-head">
              <div><b>{r.code?.text ?? 'Report'}</b><div className="muted">{fmtDate(r.effectiveDateTime ?? r.issued)}</div></div>
              <Button variant="muted" onClick={() => setSource(r as unknown as Res)}>Source</Button>
            </header>
            {r.presentedForm!.map((a, i) => renderAttachment(a, i))}
          </article>
        ))}
      </div>

      {compact ? (
        <div className="encounter-block">
          {groups.map(([type, list]) => (
            <Collapse key={type} label={<b>{PLURAL[type] ?? type} ({list.length})</b>}>
              {linkedList(list as Res[])}
            </Collapse>
          ))}
        </div>
      ) : (
        <div className="linked-grid">
          {groups.map(([type, list]) => (
            <section key={type} className="linked-group">
              <h3 className="encounter-subhead">{PLURAL[type] ?? type} ({list.length})</h3>
              {linkedList(list as Res[])}
            </section>
          ))}
        </div>
      )}

      {source && (
        <SourceDialog open onClose={() => setSource(null)} resource={source} title={`${source.resourceType}/${source.id}`} />
      )}
    </div>
  );
}
