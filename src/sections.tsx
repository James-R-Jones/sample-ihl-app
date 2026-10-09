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
import { TherapyOutcomes } from './components/TherapyOutcomes';
import { IBD_CLASSES, OTHER_MEDS, TreatmentTimeline } from './components/TreatmentTimeline';
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
          <div className="lab-picker">
            {[...IBD_CLASSES, OTHER_MEDS].map(c => {
              const isOther = c.key === OTHER_MEDS.key;
              const on = (isOther ? config.otherMeds : true) && !config.hiddenMedClasses.includes(c.key);
              return (
                <label key={c.key} className="setting-row">
                  <CheckBox
                    checked={on}
                    onChange={() => {
                      const hidden = config.hiddenMedClasses.filter(k => k !== c.key);
                      if (isOther) set({ otherMeds: !on, hiddenMedClasses: hidden });
                      else set({ hiddenMedClasses: on ? [...hidden, c.key] : hidden });
                    }}
                  />
                  <i className="legend-swatch" style={{ background: c.color }} />
                  {c.label}
                </label>
              );
            })}
          </div>
          <div className="setting-inline">
            <span className="muted-label">Courses</span>
            <RadioButton
              value={config.medStatus}
              onChange={v => set({ medStatus: v as 'all' | 'active' })}
              options={[{ value: 'all', label: 'All' }, { value: 'active', label: 'Active only' }]}
            />
          </div>
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

  outcomes: {
    title: 'Therapy outcomes in similar children',
    render: (config, ctx) => (
      // Remount when the patient or the defaults change, so the stratifiers
      // start again from the patient's values.
      <TherapyOutcomes
        key={`${ctx.patient.id}:${JSON.stringify(config)}`}
        patient={ctx.patient}
        resources={ctx.resources}
        config={config}
      />
    ),
    settings: (config, set) => (
      <>
        <fieldset className="setting-group">
          <legend className="muted-label">Match on by default</legend>
          <div className="lab-picker">
            {([
              ['age', 'Age at diagnosis'], ['gender', 'Gender'], ['subtype', 'IBD subtype'],
              ['severity', 'Severity at presentation'], ['perianal', "Perianal disease (Crohn's only)"],
            ] as const).map(([k, label]) => (
              <label key={k} className="setting-row">
                <CheckBox checked={config.use[k]} onChange={e => set({ use: { ...config.use, [k]: e.currentTarget.checked } })} />
                {label}
              </label>
            ))}
          </div>
        </fieldset>
        <fieldset className="setting-group">
          <legend className="muted-label">When an exact match is too small</legend>
          <label className="setting-row">
            <CheckBox checked={config.autoWiden} onChange={e => set({ autoWiden: e.currentTarget.checked })} />
            Widen automatically until two therapies can be compared
          </label>
        </fieldset>
        <fieldset className="setting-group">
          <legend className="muted-label">Default age window</legend>
          <RadioButton
            value={config.ageWindow}
            onChange={v => set({ ageWindow: Number(v) })}
            options={[0, 1, 2, 3, 5].map(w => ({ value: w, label: w === 0 ? 'Exact' : `±${w} y` }))}
          />
        </fieldset>
        <fieldset className="setting-group">
          <legend className="muted-label">Default outcome window</legend>
          <RadioButton
            value={config.horizon}
            onChange={v => set({ horizon: Number(v) as typeof config.horizon })}
            options={[1, 2, 3, 5].map(h => ({ value: h, label: `${h} yr` }))}
          />
        </fieldset>
        <fieldset className="setting-group">
          <legend className="muted-label">Charts</legend>
          <label className="setting-row">
            <CheckBox checked={config.showCurves} onChange={e => set({ showCurves: e.currentTarget.checked })} />
            Share still event-free by year
          </label>
          <label className="setting-row">
            <CheckBox checked={config.showRanges} onChange={e => set({ showRanges: e.currentTarget.checked })} />
            Average event-free years with ranges
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
