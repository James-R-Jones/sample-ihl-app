/**
 * Event-free survival by first-line therapy, estimated from the cube.
 *
 * Ported unchanged from the IBD Therapy Outcome Picker (and its
 * rank_therapies_from_cube.py): an actuarial (Cutler-Ederer) life table per
 * therapy over whole years 0 to 5, and restricted mean event-free time (RMST)
 * up to the chosen horizon.
 *
 * Small-cell suppression hides some patients from the year-by-status cells.
 * Each estimate is computed three ways: "mid" spreads hidden patients in the
 * visible event/censor ratio, "low" counts them all as events, "high" counts
 * them all as censored. low/high bound what the data allows.
 */
import { THERAPIES, type Cube } from './cube';

const NL = 6;           // year levels: 0, 1, 2, 3, 4, >=5
const MIN_N = 30;       // patients needed to rank a therapy
const MIN_VIS = 30;     // percent of those patients visible in year cells

/** Cube level indexes (0 = rolled up). ages are actual ages, or null for all ages. */
export interface Strata {
  ages: number[] | null;
  gender: number;
  subtype: number;
  severity: number;
  perianal: number;
}

export type Curve = number[]; // S(0..5)

export interface TherapyResult {
  therapy: (typeof THERAPIES)[number];
  index: number;
  n: number;
  visible: number;
  visiblePct: number;
  ok: boolean;
  reason: 'ok' | 'none' | 'incomplete' | 'thin';
  S?: { mid: Curve; low: Curve; high: Curve };
}

export interface RankedTherapy extends TherapyResult {
  S: { mid: Curve; low: Curve; high: Curve };
  rmst: number;
  lo: number;
  hi: number;
}

function lifeS(ev: number[], ce: number[], N: number, H: number): Curve {
  let removed = 0, S = 1; const out = [1];
  for (let m = 0; m < H; m++) {
    const n = N - removed; let S1: number;
    if (n <= 0) S1 = 0;
    else { const ne = n - ce[m] / 2; const q = ne > 0 ? ev[m] / ne : 1; S1 = S * (1 - Math.min(q, 1)); }
    out.push(S1); S = S1; removed += ev[m] + ce[m];
  }
  return out;
}

export const rmstOf = (S: Curve, h: number) => { let r = 0; for (let m = 0; m < h; m++) r += (S[m] + S[m + 1]) / 2; return r; };

function arrays(evV: number[], ceV: number[], tot: number[], N: number, mode: 'mid' | 'low' | 'high', multi: boolean) {
  const ev = evV.slice(), ce = ceV.slice();
  const hid = tot.map((t, m) => Math.max(t - evV[m] - ceV[m], 0));
  let seen = 0; for (let m = 0; m < NL; m++) seen += Math.max(tot[m], evV[m] + ceV[m]);
  const u = Math.max(N - seen, 0);
  const all = [...Array(NL).keys()];
  const missing = multi ? all : all.filter(m => tot[m] === 0);
  const mstar = missing.length ? missing[0] : 0;
  const vE = evV.reduce((a, b) => a + b, 0), vA = vE + ceV.reduce((a, b) => a + b, 0);
  const rAll = vA ? vE / vA : 0.5;
  for (let m = 0; m < NL; m++) {
    if (mode === 'low') ev[m] += hid[m];
    else if (mode === 'high') ce[m] += hid[m];
    else { const vm = evV[m] + ceV[m]; const r = vm ? evV[m] / vm : rAll; ev[m] += hid[m] * r; ce[m] += hid[m] * (1 - r); }
  }
  if (mode === 'low') ev[mstar] += u;
  else if (mode === 'mid' && u > 0 && missing.length) {
    if (multi) {
      const base = ev.map((e, m) => e + ce[m]); const tb = base.reduce((a, b) => a + b, 0) || 1;
      for (let m = 0; m < NL; m++) { ev[m] += u * base[m] / tb * rAll; ce[m] += u * base[m] / tb * (1 - rAll); }
    } else for (const m of missing) { ev[m] += u / missing.length * rAll; ce[m] += u / missing.length * (1 - rAll); }
  }
  return [ev, ce] as const;
}

function therapyRow(cube: Cube, s: Strata, t: number): TherapyResult {
  const th = t + 1;
  const ages = s.ages ? s.ages.map(a => a + 1) : [0];
  const get = (time: number, status: number, a: number) =>
    cube.get([time, status, a, th, s.gender, s.subtype, s.severity, s.perianal]);
  const Ns = ages.map(a => get(0, 0, a));
  const N = Ns.reduce((a, b) => a + b, 0);
  const base: TherapyResult = { therapy: THERAPIES[t], index: t, n: N, visible: 0, visiblePct: 0, ok: false, reason: N === 0 ? 'none' : 'incomplete' };
  if (N === 0 || !Ns.every(n => n > 0)) return base;
  const ev = Array(NL).fill(0), ce = Array(NL).fill(0), tot = Array(NL).fill(0);
  for (let i = 0; i < NL; i++) {
    for (const a of ages) {
      tot[i] += get(i + 1, 0, a);
      for (let st = 0; st < 3; st++) { const c = get(i + 1, st + 1, a); if (st === 2) ce[i] += c; else ev[i] += c; }
    }
  }
  const visible = ev.reduce((a, b) => a + b, 0) + ce.reduce((a, b) => a + b, 0);
  const S = {} as NonNullable<TherapyResult['S']>;
  for (const mode of ['mid', 'low', 'high'] as const) {
    const [e2, c2] = arrays(ev, ce, tot, N, mode, ages.length > 1);
    S[mode] = lifeS(e2, c2, N, 5);
  }
  const visiblePct = 100 * visible / N;
  const ok = N >= MIN_N && visiblePct >= MIN_VIS;
  return { ...base, visible, visiblePct, S, ok, reason: ok ? 'ok' : 'thin' };
}

export interface Evaluation {
  rows: TherapyResult[];
  /** Therapies with enough data, best average event-free time first. */
  ranked: RankedTherapy[];
  /** Patients in the stratum across all therapies (sum of therapy rows). */
  n: number;
  /** True when the top therapy's low bound beats the runner-up's high bound. */
  clear: boolean;
}

export function evaluate(cube: Cube, s: Strata, horizon: number): Evaluation {
  const rows = THERAPIES.map((_, t) => therapyRow(cube, s, t));
  const ranked = rows
    .filter((r): r is TherapyResult & { S: RankedTherapy['S'] } => r.ok && !!r.S)
    .map(r => ({ ...r, rmst: rmstOf(r.S.mid, horizon), lo: rmstOf(r.S.low, horizon), hi: rmstOf(r.S.high, horizon) }))
    .sort((a, b) => b.rmst - a.rmst);
  const clear = ranked.length >= 2 && ranked[0].lo > ranked[1].hi;
  return { rows, ranked, n: rows.reduce((a, r) => a + r.n, 0), clear };
}

/* ---------- strata from a profile ---------- */

export type StratKey = 'gender' | 'subtype' | 'severity' | 'perianal';
export const STRAT_KEYS: StratKey[] = ['gender', 'subtype', 'severity', 'perianal'];

/** Level indexes are 0-based level positions here; null means not used. */
export interface Selection {
  age: number | null;
  /** Years either side of age. null = all ages. */
  ageWindow: number | null;
  gender: number | null;
  subtype: number | null;
  severity: number | null;
  perianal: number | null;
}

export const SUBTYPE_CD = 0;

export function ageRange(age: number, w: number) {
  const lo = Math.max(age - w, 0), hi = Math.min(age + w, 17);
  return Array.from({ length: hi - lo + 1 }, (_, i) => lo + i);
}

export function toStrata(sel: Selection): Strata {
  const lvl = (v: number | null) => (v == null ? 0 : v + 1);
  // Perianal disease is only assessed for Crohn's disease.
  const perianal = sel.subtype === SUBTYPE_CD ? lvl(sel.perianal) : 0;
  return {
    ages: sel.age == null || sel.ageWindow == null ? null : ageRange(sel.age, sel.ageWindow),
    gender: lvl(sel.gender), subtype: lvl(sel.subtype), severity: lvl(sel.severity), perianal,
  };
}

/** Age windows tried when widening, with the picker's relative costs. */
export const AGE_WINDOWS: { w: number | null; cost: number }[] = [
  { w: 0, cost: 0 }, { w: 1, cost: 0.25 }, { w: 2, cost: 0.5 }, { w: 3, cost: 0.75 }, { w: 5, cost: 1 }, { w: null, cost: 1.5 },
];

/**
 * The nearest selection, made only by widening the age window and dropping
 * stratifiers, where at least two therapies can be ranked. Subtype and
 * severity are dropped last, as in the picker. Returns null if none works.
 */
export function widen(cube: Cube, sel: Selection, horizon: number): { sel: Selection; dropped: StratKey[]; ev: Evaluation } | null {
  const on = STRAT_KEYS.filter(k => sel[k] != null && (k !== 'perianal' || sel.subtype === SUBTYPE_CD));
  const startCost = AGE_WINDOWS.find(a => a.w === sel.ageWindow)?.cost ?? 1.5;
  const windows = sel.age == null ? [{ w: null, cost: 0 }] : AGE_WINDOWS.filter(a => a.cost >= startCost).map(a => ({ ...a, cost: a.cost - startCost }));
  const weight = (k: StratKey) => (k === 'subtype' || k === 'severity' ? 3 : 1);
  const specs: { keep: StratKey[]; w: number | null; cost: number }[] = [];
  for (let mask = 0; mask < 1 << on.length; mask++) {
    const keep = on.filter((_, i) => mask & (1 << i));
    if (keep.includes('perianal') && !keep.includes('subtype')) continue;
    const dropCost = on.filter(k => !keep.includes(k)).reduce((a, k) => a + weight(k), 0);
    for (const win of windows) specs.push({ keep, w: win.w, cost: dropCost + win.cost });
  }
  specs.sort((a, b) => a.cost - b.cost || b.keep.length - a.keep.length);
  for (const sp of specs) {
    const next: Selection = { ...sel, ageWindow: sp.w };
    for (const k of STRAT_KEYS) if (!sp.keep.includes(k)) next[k] = null;
    const ev = evaluate(cube, toStrata(next), horizon);
    if (ev.ranked.length >= 2) return { sel: next, dropped: on.filter(k => !sp.keep.includes(k)), ev };
  }
  return null;
}
