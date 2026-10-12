/**
 * Which population cube the Therapy outcomes section compares a patient
 * against. Chosen on the patient list (and in the section's settings), kept
 * per browser.
 *
 * Any table the study API serves with the EFS cube's columns works (see
 * DIMENSIONS in cube.ts, plus `cnt`); on 2026-10-12 the only one was
 * ibd_0_17_years_efs_cube_client_min10, served by both study API hosts. The
 * bundled CSV is a copy of it.
 */
import { useSyncExternalStore } from 'react';

export interface Population {
  id: string;
  label: string;
  /** Study API cohort base: {origin}/…/study/{study}/cohort/{cohort}. */
  api?: string;
  table?: string;
  /** CSV path under the app's base URL. */
  file?: string;
  builtin?: boolean;
}

export const DEFAULT_TABLE = 'ibd_0_17_years_efs_cube_client_min10';
export const BUNDLED_FILE = 'data/ibd_0_17_years_efs_cube_min10.csv';

export const BUILTIN_POPULATIONS: Population[] = [
  {
    id: 'prod-ibd-v2', builtin: true,
    label: 'IBD v2, ages 0–17 · smartcumulus.org',
    api: 'https://www.smartcumulus.org/synthetic/study/ibd/cohort/cumulus_sim_ibd_v2_db', table: DEFAULT_TABLE,
  },
  {
    id: 'test-ibd-v2', builtin: true,
    label: 'IBD v2, ages 0–17 · dashboard-test',
    api: 'https://dashboard-test.smartcumulus.org/test/study/ibd/cohort/cumulus_sim_ibd_v2_db', table: DEFAULT_TABLE,
  },
  {
    id: 'bundled', builtin: true,
    label: 'IBD v2, ages 0–17 · bundled copy (2026-10-12)',
    file: BUNDLED_FILE,
  },
];

const KEY = 'ihl-patient-app.population';
const CUSTOM_KEY = 'ihl-patient-app.populations.custom';
const listeners = new Set<() => void>();
const read = <T,>(k: string, fallback: T): T => { try { return JSON.parse(localStorage.getItem(k) ?? 'null') ?? fallback; } catch { return fallback; } };

export const customPopulations = (): Population[] => read<Population[]>(CUSTOM_KEY, []);
export const allPopulations = () => [...BUILTIN_POPULATIONS, ...customPopulations()];

let currentId: string = read<string>(KEY, BUILTIN_POPULATIONS[0].id);
let version = 0;
const emit = () => { version++; listeners.forEach(l => l()); };

let memo: { version: number; p: Population } | null = null;

/** The selected population (the same object until the choice changes). */
export function currentPopulation(): Population {
  if (memo?.version !== version) memo = { version, p: allPopulations().find(p => p.id === currentId) ?? BUILTIN_POPULATIONS[0] };
  return memo.p;
}

export function selectPopulation(id: string) {
  currentId = id;
  try { localStorage.setItem(KEY, JSON.stringify(id)); } catch { /* ignore */ }
  emit();
}

/** Saves a study API table as a population and selects it. */
export function addPopulation(api: string, table: string, label?: string): Population {
  const base = api.trim().replace(/\/+$/, '').replace(/\/(cube|details)(\?.*)?$/, '');
  const cohort = base.split('/').pop();
  const p: Population = {
    id: `custom-${Date.now().toString(36)}`, api: base, table: table.trim(),
    label: label?.trim() || `${cohort} · ${table.trim()}`,
  };
  try { localStorage.setItem(CUSTOM_KEY, JSON.stringify([...customPopulations(), p])); } catch { /* ignore */ }
  selectPopulation(p.id);
  return p;
}

export function removePopulation(id: string) {
  try { localStorage.setItem(CUSTOM_KEY, JSON.stringify(customPopulations().filter(p => p.id !== id))); } catch { /* ignore */ }
  if (currentId === id) selectPopulation(BUILTIN_POPULATIONS[0].id); else emit();
}

/** The selected population; re-renders when it changes. */
export function usePopulation(): Population {
  useSyncExternalStore(l => { listeners.add(l); return () => listeners.delete(l); }, () => version);
  return currentPopulation();
}
