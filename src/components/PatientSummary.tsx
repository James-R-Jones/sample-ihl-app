import type { Patient } from 'fhir/r4';
import { Badge } from 'clinical-primitives';
import { ageInYears, cityState, displayName, mrn } from '../patient';

export function PatientSummary({ patient, resources }: { patient: Patient; resources: Record<string, unknown[]> }) {
  const age = ageInYears(patient.birthDate);
  const types = Object.entries(resources)
    .filter(([t, rs]) => t !== 'Patient' && rs.length)
    .sort((a, b) => b[1].length - a[1].length);
  return (
    <div className="summary">
      <h2>{displayName(patient)}</h2>
      <div className="summary-meta">
        <Badge variant="neutral">{patient.gender ?? 'unknown'}</Badge>
        {age != null && <Badge variant="neutral">{age} y</Badge>}
        <span>DOB {patient.birthDate}</span>
        {mrn(patient) && <span>MRN {mrn(patient)}</span>}
        {cityState(patient) && <span>{cityState(patient)}</span>}
      </div>
      <div className="summary-counts">
        {types.map(([t, rs]) => (
          <span key={t} className="count-chip"><b>{rs.length}</b> {t}</span>
        ))}
      </div>
    </div>
  );
}
