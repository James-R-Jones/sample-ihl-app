import { useCallback, useEffect, useState } from 'react';

/**
 * Dashboard settings. Each section owns its own config (edited from the gear
 * in that section's header); `layout` holds order, visibility and width.
 */

export const SECTION_IDS = [
  'summary', 'study', 'search', 'timeline', 'outcomes', 'genomics', 'labTrends', 'labCharts',
  'conditions', 'medications', 'observations', 'immunizations',
] as const;
export type SectionId = (typeof SECTION_IDS)[number];

export interface SectionLayout {
  id: SectionId;
  visible: boolean;
  /** Full width of the grid instead of one column. */
  wide: boolean;
}

export type ObservationFilter = 'All' | 'IBD' | 'Labs' | 'Vitals' | 'Social' | 'Activity';

export interface SectionConfigs {
  summary: Record<string, never>;
  study: {
    showSummary: boolean;
    showParis: boolean;
    showTherapyLines: boolean;
    showActivity: boolean;
  };
  search: {
    /** Only results whose match is inside clinical note text. */
    notesOnly: boolean;
    /** Resource types left out of the index. */
    excludeTypes: string[];
    pageSize: number;
  };
  timeline: {
    labs: string[];
    /** Show non-IBD medications (antibiotics, inhalers, ...) as grey rows. */
    otherMeds: boolean;
    /** All courses, or only active ones. */
    medStatus: 'all' | 'active';
    /** Drug-class keys (see IBD_CLASSES, plus 'other') left off the timeline. */
    hiddenMedClasses: string[];
    /** Endoscopy procedures as their own row. */
    endoscopy: boolean;
    /** Encounter classes (v3 ActCode, e.g. AMB, EMER, IMP) to plot. */
    encounterClasses: string[];
    /** One row per encounter class, or one row per visit type. */
    encounterGroupBy: 'class' | 'type';
  };
  outcomes: {
    /** Stratifiers matched on by default; each can be switched in the section. */
    use: { age: boolean; gender: boolean; subtype: boolean; severity: boolean; perianal: boolean };
    /** Years either side of the patient's age at diagnosis. */
    ageWindow: number;
    /** Outcome window in years. */
    horizon: 1 | 2 | 3 | 5;
    showCurves: boolean;
    showRanges: boolean;
    /** On opening, widen until two therapies can be compared. */
    autoWiden: boolean;
    /** Start from the study API's computed values where it has them. */
    useStudy: boolean;
  };
  genomics: {
    /** Upper gnomAD allele frequency for the variant query (1 = any). */
    maxAf: number;
    /** Classification tiers to include; empty = any. */
    classes: string[];
    /** Only variants in genes the IBD taxonomy covers. */
    ibdGenesOnly: boolean;
    /** Hide common (gnomAD > 1%) variants in GWAS / polygenic IBD-pathway genes. */
    hideCommonIbd: boolean;
    /** Only protein-changing and splice variants (P/LP always shown). */
    codingOnly: boolean;
    pageSize: number;
  };
  labTrends: { labs: string[] };
  labCharts: { labs: string[]; height: number };
  conditions: Record<string, never>;
  medications: { source: 'MedicationRequest' | 'MedicationAdministration' };
  observations: { filters: ObservationFilter[] };
  immunizations: Record<string, never>;
}

export interface Settings {
  version: 2;
  /** Bumped when the default layout changes; older saved layouts are reset to it once. */
  layoutRev?: number;
  layout: SectionLayout[];
  config: SectionConfigs;
  theme: 'system' | 'light' | 'dark';
}

const IBD_LABS = ['CRP', 'ESR', 'Calprotectin', 'Albumin', 'Hemoglobin', 'Platelets', 'Weight', 'BMI'];

/**
 * Default sections: patient, search, timeline, therapy outcomes, genomic
 * findings. The rest are hidden "Template:" sections, offered from the
 * Sections menu as starting points.
 */
const LAYOUT_REV = 3;

export const DEFAULT_SETTINGS: Settings = {
  version: 2,
  layoutRev: LAYOUT_REV,
  layout: [
    { id: 'summary',       visible: true,  wide: true },
    { id: 'study',         visible: false, wide: true },
    { id: 'search',        visible: true,  wide: true },
    { id: 'timeline',      visible: true,  wide: true },
    { id: 'outcomes',      visible: true,  wide: true },
    { id: 'genomics',      visible: true,  wide: true },
    // Available from the Sections menu on a patient page.
    { id: 'labTrends',     visible: false, wide: false },
    { id: 'conditions',    visible: false, wide: false },
    { id: 'labCharts',     visible: false, wide: true },
    { id: 'medications',   visible: false, wide: false },
    { id: 'immunizations', visible: false, wide: false },
    { id: 'observations',  visible: false, wide: true },
  ],
  config: {
    summary: {},
    study: { showSummary: true, showParis: true, showTherapyLines: true, showActivity: true },
    search: { notesOnly: false, excludeTypes: [], pageSize: 25 },
    timeline: {
      labs: ['CRP', 'Calprotectin', 'Albumin', 'Hemoglobin'],
      otherMeds: false,
      medStatus: 'all',
      hiddenMedClasses: [],
      endoscopy: true,
      // Every class; rows only appear for classes this patient has.
      encounterClasses: ['AMB', 'EMER', 'IMP', 'OBSENC', 'VR', 'HH', 'OTHER'],
      encounterGroupBy: 'class',
    },
    outcomes: {
      use: { age: true, gender: true, subtype: true, severity: true, perianal: true },
      ageWindow: 1,
      horizon: 2,
      showCurves: true,
      showRanges: true,
      autoWiden: true,
      useStudy: true,
    },
    genomics: {
      maxAf: 0.01,
      classes: ['Pathogenic', 'Likely_pathogenic', 'Conflicting_classifications_of_pathogenicity', 'VUS'],
      ibdGenesOnly: true,
      hideCommonIbd: true,
      codingOnly: true,
      pageSize: 12,
    },
    labTrends: { labs: IBD_LABS },
    labCharts: { labs: IBD_LABS, height: 160 },
    conditions: {},
    medications: { source: 'MedicationRequest' },
    observations: { filters: ['IBD', 'Labs', 'Vitals'] },
    immunizations: {},
  },
  theme: 'system',
};

const KEY = 'ihl-patient-app.settings.v2';

/** Merge saved settings over the defaults so new sections and fields appear. */
function load(): Settings {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<Settings> | null;
    if (!saved || saved.version !== 2) return DEFAULT_SETTINGS;
    // Sections added since the layout was saved go in at their default
    // position: right after the section that precedes them in the defaults.
    const layout = saved.layoutRev === LAYOUT_REV
      ? (saved.layout ?? []).filter(l => SECTION_IDS.includes(l.id))
      : DEFAULT_SETTINGS.layout.map(l => ({ ...l }));
    DEFAULT_SETTINGS.layout.forEach((d, i) => {
      if (layout.some(l => l.id === d.id)) return;
      const before = DEFAULT_SETTINGS.layout.slice(0, i).reverse().find(p => layout.some(l => l.id === p.id));
      layout.splice(before ? layout.findIndex(l => l.id === before.id) + 1 : 0, 0, d);
    });
    const config = { ...DEFAULT_SETTINGS.config } as SectionConfigs;
    for (const id of SECTION_IDS) {
      (config as any)[id] = { ...DEFAULT_SETTINGS.config[id], ...(saved.config as any)?.[id] };
    }
    // Earlier versions stored care events as three booleans.
    const old = (saved.config as any)?.timeline?.events;
    if (old && !(saved.config as any).timeline.encounterClasses) {
      config.timeline.endoscopy = old.colonoscopy ?? true;
      config.timeline.encounterClasses = [...(old.emergency ? ['EMER'] : []), ...(old.inpatient ? ['IMP'] : [])];
    }
    delete (config.timeline as any).events;
    return { ...DEFAULT_SETTINGS, ...saved, layoutRev: LAYOUT_REV, layout, config };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function useSettings() {
  const [settings, setSettings] = useState<Settings>(load);

  useEffect(() => {
    try { localStorage.setItem(KEY, JSON.stringify(settings)); } catch { /* ignore */ }
    const root = document.documentElement;
    if (settings.theme === 'system') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', settings.theme);
  }, [settings]);

  const setTheme = useCallback((theme: Settings['theme']) =>
    setSettings(s => ({ ...s, theme })), []);

  const setConfig = useCallback(<K extends SectionId>(id: K, patch: Partial<SectionConfigs[K]>) =>
    setSettings(s => ({ ...s, config: { ...s.config, [id]: { ...s.config[id], ...patch } } })), []);

  const setLayout = useCallback((id: SectionId, patch: Partial<Omit<SectionLayout, 'id'>>) =>
    setSettings(s => ({ ...s, layout: s.layout.map(l => (l.id === id ? { ...l, ...patch } : l)) })), []);

  /** Move a section one place up (-1) or down (+1) among the visible ones. */
  const move = useCallback((id: SectionId, dir: -1 | 1) =>
    setSettings(s => {
      const visible = s.layout.filter(l => l.visible);
      const i = visible.findIndex(l => l.id === id);
      const other = visible[i + dir];
      if (i < 0 || !other) return s;
      const layout = [...s.layout];
      const a = layout.findIndex(l => l.id === id);
      const b = layout.findIndex(l => l.id === other.id);
      [layout[a], layout[b]] = [layout[b], layout[a]];
      return { ...s, layout };
    }), []);

  const reset = useCallback(() => setSettings(DEFAULT_SETTINGS), []);

  return { settings, setTheme, setConfig, setLayout, move, reset };
}

export type SettingsApi = ReturnType<typeof useSettings>;
