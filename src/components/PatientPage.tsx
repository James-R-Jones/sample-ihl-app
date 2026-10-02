import { useEffect } from 'react';
import type { Patient } from 'fhir/r4';
import { Alert, Loader, useClinicalData } from 'clinical-primitives';
import { getPatientResources } from '../api';
import type { Route } from '../routes';
import type { SettingsApi } from '../settings';
import { EncounterView } from './EncounterView';
import { PatientDashboard } from './PatientDashboard';

/**
 * Loads one patient's record into ClinicalDataProvider and shows either the
 * dashboard or a single encounter. Stays mounted while moving between the two,
 * so the record is fetched once per patient.
 */
export function PatientPage({ route, settingsApi }: {
  route: Extract<Route, { patientId: string }>;
  settingsApi: SettingsApi;
}) {
  const { patient, resources, isLoading, error, loadFromResources, clear } = useClinicalData();
  const { patientId } = route;

  useEffect(() => {
    const ctrl = new AbortController();
    clear();
    getPatientResources(patientId, ctrl.signal)
      .then(rs => { if (!ctrl.signal.aborted) return loadFromResources(rs); })
      .catch(e => { if (!ctrl.signal.aborted) console.error(e); });
    return () => ctrl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [patientId]);

  const p = patient as Patient | null;
  const ready = p?.id === patientId;

  if (error) return <Alert variant="danger">Could not load patient: {error.message}</Alert>;
  if (isLoading || !ready) return <Loader msg="Loading patient record…" centered />;

  const all = (resources ?? {}) as Record<string, unknown[]>;
  return route.name === 'encounter'
    ? <EncounterView key={route.encounterId} patient={p!} encounterId={route.encounterId} resources={all} />
    : <PatientDashboard patient={p!} resources={all} settingsApi={settingsApi} search={route.search} />;
}
