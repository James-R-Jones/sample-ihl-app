import { useEffect } from 'react';
import type { Patient } from 'fhir/r4';
import { Button } from 'clinical-primitives';
import { href, navigate, type SearchIntent } from '../routes';
import { SECTIONS, type SectionContext } from '../sections';
import type { SectionConfigs, SectionId, SettingsApi } from '../settings';
import { Section } from './Section';

interface Props {
  patient: Patient;
  resources: Record<string, unknown[]>;
  settingsApi: SettingsApi;
  search?: SearchIntent;
}

export function PatientDashboard({ patient, resources, settingsApi, search }: Props) {
  const { settings, setConfig, setLayout, move } = settingsApi;
  const visible = settings.layout.filter(l => l.visible);
  const ctx: SectionContext = { patient, resources, search };

  // Arriving with a search needs the search section on screen.
  const searchHidden = !settings.layout.find(l => l.id === 'search')?.visible;
  useEffect(() => {
    if (search?.q && searchHidden) setLayout('search', { visible: true });
  }, [search?.q, searchHidden, setLayout]);

  // Generic over the id so each section's render/settings get its own config type.
  const renderSection = <K extends SectionId>(id: K, wide: boolean, index: number) => {
    const def = SECTIONS[id];
    const config = settings.config[id];
    const set = (patch: Partial<SectionConfigs[K]>) => setConfig(id, patch);
    return (
      <Section
        key={id}
        title={def.title}
        settings={def.settings?.(config, set)}
        wide={wide}
        isFirst={index === 0}
        isLast={index === visible.length - 1}
        onWide={w => setLayout(id, { wide: w })}
        onMove={dir => move(id, dir)}
        onHide={() => setLayout(id, { visible: false })}
      >
        {def.render(config, ctx)}
      </Section>
    );
  };

  return (
    <div className="dashboard">
      <div className="page-head">
        <Button variant="muted" onClick={() => navigate(href.list())}>← All patients</Button>
      </div>
      <div className="section-grid">
        {visible.map((l, i) => renderSection(l.id, l.wide, i))}
        {visible.length === 0 && (
          <p className="muted">All sections are hidden. Use the Sections menu to bring them back.</p>
        )}
      </div>
    </div>
  );
}
