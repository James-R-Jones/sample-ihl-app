/**
 * The event-free survival cube behind the Therapy outcomes section.
 *
 * A cube is a table of patient counts for every combination of its
 * dimensions, with a blank value meaning "rolled up" (all values). Cells with
 * fewer than 10 patients are removed. See public/data/*_data_dictionary.json.
 *
 * Cells are stored by level index: 0 is the rolled-up value and 1..n are the
 * levels below, in the order listed. The engine (engine.ts) works only with
 * these indexes, so a different source (the study API's /cube endpoint, say)
 * only has to produce the same Cube.
 */
import { useEffect, useState } from 'react';
import { BUNDLED_FILE, usePopulation, type Population } from './population';

export const DIMENSIONS = {
  event_free_survival_years: ['0', '1', '2', '3', '4', '>=5'],
  efs_status: ['Steroid rescue', 'Escalation or surgery', 'Censored'],
  age_at_initial_diagnosis_years: Array.from({ length: 18 }, (_, i) => String(i)),
  firstline_therapy: ['AMINOSALICYLATE', 'IMMUNOMODULATOR', 'ANTI_TNF', 'ANTI_INTERLEUKIN', 'ANTI_INTEGRIN', 'JAK_INHIBITOR'],
  gender: ['male', 'female'],
  ibd_subtype: ["Crohn's Disease", 'Ulcerative Colitis', 'IBD-Unclassified'],
  severity: ['Mild', 'Moderate', 'Severe'],
  perianal_disease: ['Yes', 'No', 'Not Applicable'],
} as const;

export type Dimension = keyof typeof DIMENSIONS;
/** Key order of a cell. */
export const DIM_ORDER = Object.keys(DIMENSIONS) as Dimension[];
export type Therapy = (typeof DIMENSIONS)['firstline_therapy'][number];
export const THERAPIES = DIMENSIONS.firstline_therapy;

export interface Cube {
  /** Count for a cell, keyed by level indexes joined with '.'; 0 when suppressed or absent. */
  get(idx: number[]): number;
  /** Total patients in the cube (the all-rolled-up row). */
  total: number;
  /** Where the cube came from, for the footnote. */
  source: string;
  rows: number;
}

/** Build a cube from rows of {dimension: value | '' | null, cnt}. */
export function cubeFromRows(rows: Iterable<Record<string, string | number | null | undefined>>, source: string): Cube {
  const cells = new Map<string, number>();
  let n = 0;
  rows: for (const r of rows) {
    const key: number[] = [];
    for (const d of DIM_ORDER) {
      const v = r[d];
      if (v == null || v === '') { key.push(0); continue; }
      const i = (DIMENSIONS[d] as readonly string[]).indexOf(String(v));
      if (i < 0) continue rows; // a level this app does not know; skip the row
      key.push(i + 1);
    }
    cells.set(key.join('.'), Number(r.cnt) || 0);
    n++;
  }
  return {
    get: idx => cells.get(idx.join('.')) ?? 0,
    total: cells.get(DIM_ORDER.map(() => 0).join('.')) ?? 0,
    source,
    rows: n,
  };
}

/** Minimal CSV parser: quoted fields with "" escapes, no embedded newlines. */
export function parseCsv(text: string): Record<string, string>[] {
  const split = (line: string) => {
    const out: string[] = []; let cur = ''; let q = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (q) { if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') q = false; else cur += c; }
      else if (c === '"') q = true;
      else if (c === ',') { out.push(cur); cur = ''; }
      else cur += c;
    }
    out.push(cur);
    return out;
  };
  const lines = text.split(/\r?\n/).filter(l => l.length);
  const head = split(lines[0]);
  return lines.slice(1).map(l => { const v = split(l); return Object.fromEntries(head.map((h, i) => [h, v[i] ?? ''])); });
}

/**
 * Loading a population's cube (population.ts). A study API population falls
 * back to the bundled CSV when the API is unreachable, for the built-in
 * choices only; a custom table that fails shows the error instead.
 *
 * GET {api}/cube?tables=<table> returns
 * {status: 'complete' | 'pending', cubes: [{name, count, columns: [{name}], rows: [[...]]}]};
 * 'pending' (HTTP 202) means poll again after Retry-After.
 */
export const REQUIRED_COLUMNS = [...DIM_ORDER, 'cnt'];

async function loadCubeFromApi(api: string, table: string): Promise<Cube> {
  const url = `${api}/cube?tables=${encodeURIComponent(table)}`;
  for (let attempt = 0; attempt < 10; attempt++) {
    const res = await fetch(url);
    if (res.status === 202) {
      await new Promise(r => setTimeout(r, 1000 * (Number(res.headers.get('Retry-After')) || 2)));
      continue;
    }
    if (!res.ok) {
      const detail = await res.json().then(j => j?.detail, () => null);
      throw new Error(`HTTP ${res.status}${typeof detail === 'string' ? `: ${detail}` : ''}`);
    }
    const body = await res.json() as { cubes?: { name: string; columns: { name: string }[]; rows: unknown[][] }[] };
    const cube = body.cubes?.find(c => c.name === table) ?? body.cubes?.[0];
    if (!cube?.rows?.length) throw new Error('the table has no rows');
    const names = cube.columns.map(c => c.name);
    const missing = REQUIRED_COLUMNS.filter(c => !names.includes(c));
    if (missing.length) throw new Error(`${table} is not an event-free survival cube (no ${missing.join(', ')} column${missing.length > 1 ? 's' : ''})`);
    const rows = cube.rows.map(r => Object.fromEntries(names.map((n, i) => [n, r[i] as string | number | null])));
    const host = new URL(api).host;
    const built = cubeFromRows(rows, `Study API at ${host}, ${api.split('/').pop()} ${table}, cells under 10 removed`);
    if (!built.total) throw new Error('no cohort total row');
    return built;
  }
  throw new Error('still pending after 10 tries');
}

async function loadCubeFromFile(file: string, note = ''): Promise<Cube> {
  const url = `${import.meta.env.BASE_URL}${file}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Could not load ${file} (HTTP ${res.status})`);
  return cubeFromRows(parseCsv(await res.text()), `Copy of the synthetic IBD v2 cube bundled with the app, ages 0 to 17, cells under 10 removed${note}`);
}

async function loadCube(p: Population): Promise<Cube> {
  if (!p.api || !p.table) return loadCubeFromFile(p.file ?? BUNDLED_FILE);
  try {
    return await loadCubeFromApi(p.api, p.table);
  } catch (e) {
    if (!p.builtin) throw e;
    console.warn(`Outcome cube: ${p.label} failed, using the bundled CSV:`, e);
    return loadCubeFromFile(BUNDLED_FILE, ` (${new URL(p.api).host} unavailable: ${(e as Error).message})`);
  }
}

const cached = new Map<string, Promise<Cube>>();

/** Loads (or tests) a population's cube, cached per population. */
export function cubeFor(p: Population): Promise<Cube> {
  const key = JSON.stringify([p.api, p.table, p.file]);
  let c = cached.get(key);
  if (!c) {
    c = loadCube(p);
    c.catch(() => cached.delete(key));
    cached.set(key, c);
  }
  return c;
}

/** The selected population's cube. */
export function useOutcomeCube() {
  const pop = usePopulation();
  const [state, setState] = useState<{ cube?: Cube; error?: string; population: Population }>({ population: pop });
  useEffect(() => {
    let live = true;
    setState({ population: pop });
    cubeFor(pop).then(
      cube => live && setState({ cube, population: pop }),
      e => live && setState({ error: String(e?.message ?? e), population: pop }),
    );
    return () => { live = false; };
  }, [pop]);
  return state;
}
