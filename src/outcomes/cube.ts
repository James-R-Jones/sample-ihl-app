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
 * The cube source. For now a static CSV shipped with the app; to read from an
 * API instead, replace this with a fetch that returns the same rows (the study
 * API's GET /study/{study}/cube returns {columns, rows}; zip those into
 * objects and pass them to cubeFromRows).
 */
export const CUBE_FILE = 'data/ibd_0_17_years_efs_cube_min10.csv';

async function loadCube(): Promise<Cube> {
  const url = `${import.meta.env.BASE_URL}${CUBE_FILE}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Could not load ${CUBE_FILE} (HTTP ${res.status})`);
  return cubeFromRows(parseCsv(await res.text()), 'Synthetic IBD cohort, ages 0 to 17, cells under 10 removed');
}

let cached: Promise<Cube> | null = null;

export function useOutcomeCube() {
  const [state, setState] = useState<{ cube?: Cube; error?: string }>({});
  useEffect(() => {
    let live = true;
    cached ??= loadCube();
    cached.then(
      cube => live && setState({ cube }),
      e => { cached = null; if (live) setState({ error: String(e?.message ?? e) }); },
    );
    return () => { live = false; };
  }, []);
  return state;
}
