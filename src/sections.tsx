/**
 * Section registry. Each entry says how to render a section and its own
 * settings panel. To add a section: add its id and default config in
 * settings.ts, then an entry here.
 */
import type { ReactNode } from 'react';
import type { Condition, Immunization, MedicationAdministration, MedicationRequest, Patient } from 'fhir/r4';
import {
  Button, CheckBox, ConditionList, ImmunizationList, LabTrendPanel, MedicationList,
  ObservationsPanel, RadioButton,
} from 'clinical-primitives';
import type { ComponentProps } from 'react';
import { COMMON_CLASSES, OTHER_CLASS, classInfo } from './encounterClasses';
import { LabCharts } from './components/LabCharts';
import { LabPicker } from './components/LabPicker';
import { PatientSummary } from './components/PatientSummary';
import { RecordSearch } from './components/RecordSearch';
import { TreatmentTimeline } from './components/TreatmentTimeline';
import type { ObservationFilter, SectionConfigs, SectionId } from './settings';
import type { SearchIntent } from './routes';

export interface SectionContext {
  patient: Patient;
  resources: Record<string, unknown[]>;
  /** A search to run on arrival (from the patient list's cohort search). */
  search?: SearchIntent;
}

interface SectionDef<K extends SectionId> {
  title: string;
  render: (config: SectionConfigs[K], ctx: SectionContext) => ReactNode;
  settings?: (config: SectionConfigs[K], set: (patch: Partial<SectionConfigs[K]>) => void) => ReactNode;
}

type Registry = { [K in SectionId]: SectionDef<K> };

const list = <T,>(ctx: SectionContext, type: string) => (ctx.resources[type] ?? []) as unknown as T[];

/** Resource types this cohort's records contain, offered as search exclusions. */
const SEARCHABLE_TYPES = [
  'AllergyIntolerance', 'CarePlan', 'CareTeam', 'Condition', 'Device', 'DiagnosticReport',
  'DocumentReference', 'Encounter', 'ImagingStudy', 'Immunization', 'Location', 'Medication',
  'MedicationAdministration', 'MedicationRequest', 'Observation', 'Organization', 'Patient',
  'Practitioner', 'PractitionerRole', 'Procedure',
];

const OBS_FILTERS: ObservationFilter[] = ['IBD', 'Labs', 'Vitals', 'Social', 'Activity', 'All'];

export const SECTIONS: Registry = {
  summary: {
    title: 'Patient',
    render: (_c, ctx) => <PatientSummary patient={ctx.patient} resources={ctx.resources} />,
  },

  search: {
    title: 'Search this record',
    render: (config, ctx) => (
      <RecordSearch resources={ctx.resources} config={config} patientId={ctx.patient.id!} intent={ctx.search} />
    ),
    settings: (config, set) => (
      <>
        <fieldset className="setting-group">
          <legend className="muted-label">Scope</legend>
          <label className="setting-row">
            <CheckBox checked={config.notesOnly} onChange={e => set({ notesOnly: e.currentTarget.checked })} />
            Only show matches inside clinical note text
          </label>
        </fieldset>
        <fieldset className="setting-group">
          <legend className="muted-label">Leave out of the search</legend>
          <div className="lab-picker">
            {SEARCHABLE_TYPES.map(t => (
              <label key={t} className="setting-row">
                <CheckBox
                  checked={config.excludeTypes.includes(t)}
                  onChange={() => set({
                    excludeTypes: config.excludeTypes.includes(t)
                      ? config.excludeTypes.filter(x => x !== t)
                      : [...config.excludeTypes, t],
                  })}
                />
                {t}
              </label>
            ))}
          </div>
        </fieldset>
        <fieldset className="setting-group">
          <legend className="muted-label">Results per page</legend>
          <RadioButton
            value={config.pageSize}
            onChange={v => set({ pageSize: Number(v) })}
            options={[{ value: 10, label: '10' }, { value: 25, label: '25' }, { value: 50, label: '50' }]}
          />
        </fieldset>
      </>
    ),
  },

  timeline: {
    title: 'Treatment timeline',
    render: config => <TreatmentTimeline config={config} />,
    settings: (config, set) => (
      <>
        <LabPicker label="Lab rows" value={config.labs} onChange={labs => set({ labs })} />
        <fieldset className="setting-group">
          <legend className="muted-label">Medications</legend>
          <label className="setting-row">
            <CheckBox checked={config.otherMeds} onChange={e => set({ otherMeds: e.currentTarget.checked })} />
            Also show non-IBD medications
          </label>
        </fieldset>
        <fieldset className="setting-group">
          <legend className="muted-label">Encounters</legend>
          <div className="lab-picker">
            {[...COMMON_CLASSES, OTHER_CLASS].map(code => (
              <label key={code} className="setting-row">
                <CheckBox
                  checked={config.encounterClasses.includes(code)}
                  onChange={() => set({
                    encounterClasses: config.encounterClasses.includes(code)
                      ? config.encounterClasses.filter(c => c !== code)
                      : [...config.encounterClasses, code],
                  })}
                />
                {code === OTHER_CLASS ? 'Other classes' : classInfo(code).label}
              </label>
            ))}
          </div>
          <div className="setting-inline">
            <Button variant="muted" onClick={() => set({ encounterClasses: [...COMMON_CLASSES, OTHER_CLASS] })}>All encounters</Button>
            <Button variant="muted" onClick={() => set({ encounterClasses: [] })}>None</Button>
            <span className="muted-label">Rows</span>
            <RadioButton
              value={config.encounterGroupBy}
              onChange={v => set({ encounterGroupBy: v as 'class' | 'type' })}
              options={[{ value: 'class', label: 'By class' }, { value: 'type', label: 'By visit type' }]}
            />
          </div>
        </fieldset>
        <fieldset className="setting-group">
          <legend className="muted-label">Procedures</legend>
          <label className="setting-row">
            <CheckBox checked={config.endoscopy} onChange={e => set({ endoscopy: e.currentTarget.checked })} />
            Endoscopy
          </label>
        </fieldset>
      </>
    ),
  },

  labTrends: {
    title: 'IBD lab trends',
    render: config => (
      <LabTrendPanel labs={config.labs as ComponentProps<typeof LabTrendPanel>['labs']} />
    ),
    settings: (config, set) => <LabPicker value={config.labs} onChange={labs => set({ labs })} />,
  },

  labCharts: {
    title: 'IBD lab charts',
    render: config => <LabCharts labs={config.labs} height={config.height} />,
    settings: (config, set) => (
      <>
        <LabPicker value={config.labs} onChange={labs => set({ labs })} />
        <fieldset className="setting-group">
          <legend className="muted-label">Chart height</legend>
          <RadioButton
            value={config.height}
            onChange={v => set({ height: Number(v) })}
            options={[{ value: 120, label: 'Compact' }, { value: 160, label: 'Medium' }, { value: 220, label: 'Tall' }]}
          />
        </fieldset>
      </>
    ),
  },

  conditions: {
    title: 'Conditions',
    render: (_c, ctx) => <ConditionList conditions={list<Condition>(ctx, 'Condition')} />,
  },

  medications: {
    title: 'Medications',
    render: (config, ctx) => (
      <MedicationList
        medications={config.source === 'MedicationAdministration'
          ? list<MedicationAdministration>(ctx, 'MedicationAdministration')
          : list<MedicationRequest>(ctx, 'MedicationRequest')}
      />
    ),
    settings: (config, set) => (
      <fieldset className="setting-group">
        <legend className="muted-label">Source</legend>
        <RadioButton
          value={config.source}
          onChange={v => set({ source: v as typeof config.source })}
          options={[
            { value: 'MedicationRequest', label: 'Prescriptions' },
            { value: 'MedicationAdministration', label: 'Administrations' },
          ]}
        />
      </fieldset>
    ),
  },

  observations: {
    title: 'Observations',
    render: config => <ObservationsPanel filters={config.filters} />,
    settings: (config, set) => (
      <fieldset className="setting-group">
        <legend className="muted-label">Tabs</legend>
        <div className="lab-picker">
          {OBS_FILTERS.map(f => (
            <label key={f} className="setting-row">
              <CheckBox
                checked={config.filters.includes(f)}
                onChange={() => set({
                  filters: config.filters.includes(f)
                    ? config.filters.filter(x => x !== f)
                    : OBS_FILTERS.filter(x => x === f || config.filters.includes(x)),
                })}
              />
              {f}
            </label>
          ))}
        </div>
      </fieldset>
    ),
  },

  immunizations: {
    title: 'Immunizations',
    render: (_c, ctx) => <ImmunizationList immunizations={list<Immunization>(ctx, 'Immunization')} />,
  },
};
