import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { DocumentReference, Encounter, Procedure } from 'fhir/r4';
import {
  Button, TimelineChart, lib, useClinicalData,
  type MedicationClassifier, type MedicationLegendEntry, type TimelineAnalyte, type TimelineMedication,
} from 'clinical-primitives';
import { LAB_CODES } from '../labs';
import { ENCOUNTER_CLASSES, classInfo, classSelected } from '../encounterClasses';
import { href, navigate } from '../routes';
import { EncounterDetail } from './EncounterDetail';
import type { SectionConfigs } from '../settings';

type Config = SectionConfigs['timeline'];

/** IBD drug classes, matched on the medication's name. First match wins. */
const IBD_CLASSES = [
  { key: 'anti-tnf',       label: 'Anti-TNF',        color: 'var(--cp-color-red)',    match: /infliximab|adalimumab|certolizumab|golimumab/i },
  { key: 'biologic',       label: 'Other biologic',  color: 'var(--cp-color-purple)', match: /vedolizumab|ustekinumab|risankizumab|mirikizumab|guselkumab/i },
  { key: 'small-molecule', label: 'JAK / S1P',       color: 'var(--cp-color-blue)',   match: /tofacitinib|upadacitinib|filgotinib|ozanimod|etrasimod/i },
  { key: 'immunomod',      label: 'Immunomodulator', color: 'var(--cp-color-amber)',  match: /methotrexate|azathioprine|mercaptopurine|cyclosporin|tacrolimus/i },
  // Systemic steroids only: inhaled budesonide and topical hydrocortisone are
  // in this cohort for asthma and eczema, not IBD.
  { key: 'steroid',        label: 'Corticosteroid',  color: 'var(--cp-color-yellow)', match: /prednisone|prednisolone|methylprednisolone|budesonide|hydrocortisone/i,
    exclude: /inhal|topical|cream|ointment|nasal|actuat/i },
  { key: '5-asa',          label: '5-ASA',           color: 'var(--cp-color-teal)',   match: /mesalamine|mesalazine|sulfasalazine|balsalazide|olsalazine/i },
] as const;

const OTHER = { key: 'other', label: 'Other', color: 'var(--cp-color-gray)' };

function ibdClass(med: TimelineMedication) {
  const text = lib.Medication.getMedicationName(med) ?? '';
  return IBD_CLASSES.find(c => c.match.test(text) && !('exclude' in c && c.exclude.test(text)));
}

function Legend({ entries }: { entries: MedicationLegendEntry[] }) {
  return (
    <div className="timeline-legend">
      {entries.map(e => (
        <span key={e.key}><i style={{ background: e.color }} />{e.label}</span>
      ))}
    </div>
  );
}

const time = (s?: string) => (s ? new Date(s).getTime() : NaN);

function periodOf(start?: string, end?: string) {
  const x1 = time(start);
  if (Number.isNaN(x1)) return null;
  const x2 = time(end);
  return { x1, x2: Number.isNaN(x2) ? x1 : x2 };
}

const fmt = (ms: number) => new Date(ms).toLocaleDateString();

export function TreatmentTimeline({ config }: { config: Config }) {
  const { resources, patient } = useClinicalData();
  const patientId = patient?.id;

  // Stable for a given setting, as MedicationsTimeline requires (it is a memo
  // dependency there). IBD therapy courses are always kept, completed ones
  // included, because the treatment history is the point of this view; the
  // section's own "only active" toggle then applies to the other medications.
  const classify = useCallback<MedicationClassifier>((base, med) => {
    const cls = ibdClass(med);
    if (cls) {
      const name = base?.name ?? lib.Medication.getShortMedicationName(med) ?? 'Unnamed medication';
      return {
        ...base, name,
        color: cls.color,
        category: { key: cls.key, label: cls.label },
        order: IBD_CLASSES.indexOf(cls),
      };
    }
    if (!config.otherMeds || !base) return null;
    return { ...base, color: OTHER.color, category: { key: OTHER.key, label: OTHER.label }, order: 100 };
  }, [config.otherMeds]);

  const analytes = useMemo<TimelineAnalyte[]>(() => config.labs
    .filter(key => LAB_CODES[key])
    .map(key => ({ code: [...LAB_CODES[key].loincs], label: LAB_CODES[key].label })),
  [config.labs]);

  // The encounter (or procedure without one) whose details are in the sidebar.
  const [selected, setSelected] = useState<string | null>(null);

  const eventRows = useMemo(() => {
    const procedures = (resources?.Procedure ?? []) as unknown as Procedure[];
    const encounters = (resources?.Encounter ?? []) as unknown as Encounter[];
    const notes = new Set(((resources?.DocumentReference ?? []) as unknown as DocumentReference[])
      .flatMap(d => (d.context?.encounter ?? []).map(r => r.reference?.split('/').pop())));
    type Bar = { x1: number; x2: number; color?: string; tooltip?: string; id?: string; onSelect?: () => void };
    const rows: { label: ReactNode; bars: Bar[] }[] = [];
    const span = (per: { x1: number; x2: number }) =>
      `${fmt(per.x1)}${fmt(per.x2) !== fmt(per.x1) ? ` to ${fmt(per.x2)}` : ''}`;

    if (config.endoscopy) {
      const bars = procedures
        .filter(p => /colonoscopy|sigmoidoscopy|endoscop/i.test(p.code?.text ?? p.code?.coding?.[0]?.display ?? ''))
        .flatMap(p => {
          const per = periodOf(p.performedPeriod?.start ?? p.performedDateTime, p.performedPeriod?.end);
          const encId = p.encounter?.reference?.split('/').pop();
          return per ? [{
            ...per, id: `Procedure/${p.id}`, color: 'var(--cp-color-blue)',
            onSelect: () => setSelected(encId ?? null),
            tooltip: `**${p.code?.text ?? 'Endoscopy'}**\n${span(per)}`,
          }] : [];
        });
      if (bars.length) rows.push({ label: 'Endoscopy', bars });
    }

    const shown = encounters.filter(e => classSelected(e.class?.code, config.encounterClasses));
    const groups = new Map<string, { label: string; classLabel: string; order: number; bars: Bar[] }>();
    for (const e of shown) {
      const per = periodOf(e.period?.start, e.period?.end);
      if (!per) continue;
      const cls = classInfo(e.class?.code);
      const type = (e.type?.[0]?.text ?? e.type?.[0]?.coding?.[0]?.display ?? cls.label)
        .replace(/ \((procedure|environment|regime\/therapy)\)$/, '');
      const key = config.encounterGroupBy === 'type' ? `${cls.code}|${type}` : cls.code;
      const label = config.encounterGroupBy === 'type' ? type : cls.label;
      const order = ENCOUNTER_CLASSES.findIndex(c => c.code === cls.code);
      const g = groups.get(key) ?? { label, classLabel: cls.label, order: order < 0 ? 99 : order, bars: [] };
      g.bars.push({
        ...per, id: `Encounter/${e.id}`, color: cls.color,
        onSelect: () => setSelected(e.id ?? null),
        tooltip: `**${type}**\n${cls.label} · ${span(per)}${notes.has(e.id) ? '\nClinical note available' : ''}`,
      });
      groups.set(key, g);
    }
    // A visit type can occur under more than one class ("Encounter for
    // problem" is both inpatient and ambulatory here); name the class then.
    const labelCount = new Map<string, number>();
    groups.forEach(g => labelCount.set(g.label, (labelCount.get(g.label) ?? 0) + 1));
    [...groups.values()]
      .sort((a, b) => a.order - b.order || b.bars.length - a.bars.length)
      .forEach(g => rows.push({
        label: (labelCount.get(g.label) ?? 0) > 1 ? `${g.label} (${g.classLabel})` : g.label,
        bars: g.bars,
      }));
    return rows;
  }, [resources, config.endoscopy, config.encounterClasses, config.encounterGroupBy]);

  // The chart's selection state is internal to the library (its context is
  // not exported), so this section tracks its own pick. Any click in the plot
  // area can change the chart's selection: another section's mark, or empty
  // space, which clears it. So every such click drops this pick first, in the
  // capture phase; if the click was on one of this section's bars, that bar's
  // onSelect runs afterwards and picks again. Clicks in the sidebar (where the
  // detail itself lives) and on row labels are left alone.
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const clear = () => setSelected(null);
    const onClick = (ev: MouseEvent) => {
      if ((ev.target as Element).closest?.('.cp-timeline-chart-layer-y-content')) clear();
    };
    const onKey = (ev: KeyboardEvent) => { if (ev.key === 'Escape') clear(); };
    el.addEventListener('click', onClick, true);
    el.addEventListener('keydown', onKey);
    return () => { el.removeEventListener('click', onClick, true); el.removeEventListener('keydown', onKey); };
  }, []);

  const selection = selected && resources ? (
    <EncounterDetail
      compact
      encounterId={selected}
      resources={resources as Record<string, unknown[]>}
      actions={patientId && (
        <Button variant="muted" onClick={() => navigate(href.encounter(patientId, selected))}>Open as page</Button>
      )}
    />
  ) : undefined;

  return (
    <div className="treatment-timeline" ref={rootRef}>
      <TimelineChart>
        <TimelineChart.MedicationsTimeline
          label="IBD therapy"
          classify={classify}
          legend={(entries: MedicationLegendEntry[]) => <Legend entries={entries} />}
        />
        {analytes.length > 0 && (
          <TimelineChart.ObservationsTimeline label="Labs" title="Labs" analytes={analytes} showAbsent={false} />
        )}
        {eventRows.length > 0 && (
          <TimelineChart.BarChartTimeline
            label="Encounters"
            rows={eventRows}
            selection={selection}
          />
        )}
      </TimelineChart>
    </div>
  );
}
