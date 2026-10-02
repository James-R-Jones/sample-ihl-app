import { useMemo } from 'react';
import type { Observation } from 'fhir/r4';
import { ObservationChart, useClinicalData } from 'clinical-primitives';
import { LAB_CODES, matchesLab } from '../labs';

/**
 * One dated ObservationChart per selected lab: time-scaled x axis with the
 * first and last dates labelled, reference-range shading, and a hover tooltip
 * showing each reading's date and value. Labs with no data are skipped.
 */
export function LabCharts({ labs, height = 160 }: { labs: string[]; height?: number }) {
  const { resources } = useClinicalData();
  const observations = (resources?.Observation ?? []) as unknown as Observation[];

  const charts = useMemo(() => labs
    .map(key => ({ key, ...LAB_CODES[key] }))
    .filter(l => l.loincs)
    .map(l => {
      // Stable per memo pass, as ObservationChart requires for a predicate.
      const select = (o: Observation) => matchesLab(o, l);
      return { ...l, select, hasData: observations.some(select) };
    })
    .filter(l => l.hasData),
  [labs, observations]);

  return (
    <>
      {charts.length === 0
        ? <p className="muted">No readings for the selected labs.</p>
        : (
          <div className="lab-charts">
            {charts.map(l => (
              <div key={l.key} className="lab-chart">
                <ObservationChart
                  observations={observations}
                  code={l.select}
                  label={l.label}
                  height={height}
                />
              </div>
            ))}
          </div>
        )}
    </>
  );
}
