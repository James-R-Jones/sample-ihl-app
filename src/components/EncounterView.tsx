import { useMemo } from 'react';
import type { Encounter, Patient } from 'fhir/r4';
import { Button } from 'clinical-primitives';
import { displayName } from '../patient';
import { href, navigate } from '../routes';
import { EncounterDetail } from './EncounterDetail';

/** Full-page view of one encounter, with previous/next visit navigation. */
export function EncounterView({ patient, encounterId, resources }: {
  patient: Patient;
  encounterId: string;
  resources: Record<string, unknown[]>;
}) {
  const encounters = useMemo(() => ((resources.Encounter ?? []) as Encounter[])
    .slice().sort((a, b) => (a.period?.start ?? '').localeCompare(b.period?.start ?? '')), [resources]);
  const index = encounters.findIndex(e => e.id === encounterId);
  const go = (e?: Encounter) => e?.id && navigate(href.encounter(patient.id!, e.id));

  return (
    <div className="encounter">
      <div className="page-head encounter-nav">
        <Button variant="muted" onClick={() => navigate(href.patient(patient.id!))}>← {displayName(patient)}</Button>
        <div className="app-spacer" />
        <Button variant="muted" disabled={index <= 0} onClick={() => go(encounters[index - 1])}>‹ Previous visit</Button>
        <Button variant="muted" disabled={index < 0 || index >= encounters.length - 1} onClick={() => go(encounters[index + 1])}>Next visit ›</Button>
      </div>
      <section className="section section--wide">
        <div className="section-body encounter-page-body">
          <EncounterDetail encounterId={encounterId} resources={resources} />
        </div>
      </section>
    </div>
  );
}
