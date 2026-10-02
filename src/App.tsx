import { ClinicalDataProvider, Tooltip } from 'clinical-primitives';
import { PatientList } from './components/PatientList';
import { PatientPage } from './components/PatientPage';
import { SectionsMenu } from './components/SectionsMenu';
import { useSettings } from './settings';
import { FHIR_API_BASE } from './config';
import { href, navigate, useRoute } from './routes';

export function App() {
  const route = useRoute();
  const settingsApi = useSettings();

  return (
    <ClinicalDataProvider>
      <div className="app">
        <header className="app-header">
          <a className="app-title" href={href.list()}>IHL Patient Explorer</a>
          <span className="app-source" title={FHIR_API_BASE}>
            {FHIR_API_BASE.split('/').slice(-1)[0]}
          </span>
          <div className="app-spacer" />
          <SectionsMenu api={settingsApi} />
        </header>
        <main className="app-main">
          {route.name === 'list'
            ? <PatientList onOpen={id => navigate(href.patient(id))} />
            : <PatientPage route={route} settingsApi={settingsApi} />}
        </main>
      </div>
      <Tooltip />
    </ClinicalDataProvider>
  );
}
