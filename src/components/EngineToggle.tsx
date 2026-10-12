import { RadioButton } from 'clinical-primitives';
import { useSearchEngine } from '../serverSearch';

/** Server / In browser switch shared by the record and cohort searches. */
export function EngineToggle() {
  const { choice, serverOk, setEngine } = useSearchEngine();
  return (
    <span className="engine-toggle">
      <span className="muted-label">Search on</span>
      <RadioButton
        value={serverOk ? choice : 'browser'}
        onChange={v => setEngine(v as 'server' | 'browser')}
        options={[
          { value: 'server', label: 'Server', disabled: !serverOk,
            title: serverOk ? 'sds-es-fhir full-text search (fhirfts)' : 'This data source has no server search' },
          { value: 'browser', label: 'In browser', title: 'Index the loaded records in this browser' },
        ]}
      />
    </span>
  );
}
