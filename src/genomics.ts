/**
 * Synthetic germline genomics for the v2 IBD cohort (genomics-api skill in
 * the IHL starter kit).
 *
 * - 30 samples in 10 trios: SYNTH_P001..P010 (children) with SYNTH_M/F (parents).
 *   A child sample's subject reference is the FHIR Patient id; parents are
 *   `<id>-M` and `<id>-F`.
 * - /identifier/* and /vcf/* are plain GETs. /query/* are jobs: POST returns an
 *   execution id, GET /query/results/{id} answers 202 until done (poll no more
 *   than every 5 s). Execution ids live 45 days, so they are remembered in
 *   localStorage and a repeat of the same query reads the stored result.
 * - The first request after a while can be slow (Lambda cold start).
 */
export const GENOMICS_API = 'https://p70a3lr56f.execute-api.us-east-1.amazonaws.com/sim/cumulus_sim_ibd_v2_db';

export interface Variant {
  vrsId: string;
  gene: string;
  chrom: string;
  pos: number;
  ref: string;
  alt: string;
}

export interface Annotated extends Variant {
  cls?: string;              // IHL_CLASS: final classification tier
  clinvar?: string;
  af?: number;               // gnomAD allele frequency
  hgvsp?: string;
  hgvsc?: string;
  consequence?: string;
  ibdBucket?: string;
  ibdRoles: string[];
  omim?: string;
  revel?: number;
  cadd?: number;
  inMother?: boolean;
  inFather?: boolean;
  common: boolean;           // came from the common IBD-pathway query
}

export interface GenomicsQuery {
  maxAf: number;             // 1 = no frequency limit
  classes: string[];
  includeCommonIbd: boolean;
  commonAf: number;
}

/* ---------- low level ---------- */

const wait = (ms: number) => new Promise(r => setTimeout(r, ms));

async function getJson<T>(path: string): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(`${GENOMICS_API}${path}`);
      if (res.ok) return res.json() as Promise<T>;
      if (attempt >= 2 || res.status < 500) throw new Error(`HTTP ${res.status} from ${path}`);
    } catch (e) {
      if (attempt >= 2) throw e;
    }
    await wait(1500 * (attempt + 1));
  }
}

const EXEC_KEY = 'ihl-patient-app.genomics.exec';
const EXEC_TTL = 44 * 864e5;
function execCache(): Record<string, { id: string; at: number }> {
  try { return JSON.parse(localStorage.getItem(EXEC_KEY) ?? '{}'); } catch { return {}; }
}
function rememberExec(key: string, id: string) {
  try {
    const now = Date.now();
    const all = Object.fromEntries(Object.entries(execCache()).filter(([, v]) => now - v.at < EXEC_TTL));
    all[key] = { id, at: now };
    localStorage.setItem(EXEC_KEY, JSON.stringify(all));
  } catch { /* ignore */ }
}
function forgetExec(key: string) {
  try { const all = execCache(); delete all[key]; localStorage.setItem(EXEC_KEY, JSON.stringify(all)); } catch { /* ignore */ }
}

const inflight = new Map<string, Promise<unknown>>();

/** Submit a query job (or reuse a remembered one) and poll until it finishes. */
export function runQuery<T>(path: string, body: object): Promise<T> {
  const key = `${path}|${JSON.stringify(body)}`;
  let p = inflight.get(key) as Promise<T> | undefined;
  if (p) return p;
  p = (async () => {
    const poll = async (id: string): Promise<T | null> => {
      for (let i = 0; i < 40; i++) {
        const res = await fetch(`${GENOMICS_API}/query/results/${id}`);
        if (res.status === 200) return res.json() as Promise<T>;
        if (res.status !== 202) return null;
        await wait(i === 0 ? 1500 : 5000);
      }
      throw new Error('Genomics query is still running after several minutes');
    };
    const known = execCache()[key];
    if (known) {
      const r = await poll(known.id).catch(() => null);
      if (r) return r;
      forgetExec(key);
    }
    const res = await fetch(`${GENOMICS_API}${path}`, { method: 'POST', body: JSON.stringify(body) });
    if (!res.ok) throw new Error(`Genomics query failed (HTTP ${res.status})`);
    const id = (await res.text()).replace(/"/g, '').trim();
    rememberExec(key, id);
    const r = await poll(id);
    if (r == null) { forgetExec(key); throw new Error('Genomics query failed'); }
    return r;
  })();
  p.catch(() => {}).finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

/* ---------- samples ---------- */

export interface SampleInfo { sampleId: string; subject: string }
const SAMPLE_KEY = 'ihl-patient-app.genomics.samples';
let samplesP: Promise<SampleInfo[]> | null = null;

/** Every sample with its subject reference (child id, or id-M / id-F). Cached for a day. */
export function listSamples(): Promise<SampleInfo[]> {
  if (samplesP) return samplesP;
  samplesP = (async () => {
    try {
      const c = JSON.parse(localStorage.getItem(SAMPLE_KEY) ?? 'null');
      if (c && Date.now() - c.at < 864e5 && c.base === GENOMICS_API) return c.samples as SampleInfo[];
    } catch { /* ignore */ }
    const ids = (await getJson<{ sample_id: string }[]>('/identifier/sample')).map(s => s.sample_id);
    const samples = await Promise.all(ids.map(async sampleId => {
      const j = await getJson<{ subject?: string }[]>(`/vcf/sample/${encodeURIComponent(sampleId)}`).catch(() => []);
      const subject = (String(j[0]?.subject ?? '').match(/reference=([^},\s]+)/) ?? [])[1] ?? '';
      return { sampleId, subject };
    }));
    try { localStorage.setItem(SAMPLE_KEY, JSON.stringify({ at: Date.now(), base: GENOMICS_API, samples })); } catch { /* ignore */ }
    return samples;
  })();
  samplesP.catch(() => { samplesP = null; });
  return samplesP;
}

/* ---------- a patient's findings ---------- */

const ANN_KEYS = {
  cls: 'IHL_CLASS',
  clinvar: 'IHL_ANN__clinvar_significance',
  af: 'IHL_ANN__gnomad_af',
  hgvsp: 'IHL_ANN__hgvsp',
  hgvsc: 'IHL_ANN__hgvsc',
  consequence: 'IHL_ANN__most_severe_consequence',
  ibdBucket: 'IHL_ANN__ibd_taxonomy_bucket',
  ibdRoles: 'IHL_ANN__ibd_taxonomy_role_set',
  omim: 'IHL_ANN__omim_phenotypes',
  revel: 'IHL_ANN__revel',
  cadd: 'IHL_ANN__cadd_phred',
} as const;

type RawVariant = { vrs_id: string; gene: string; chrom: string; start: number; ref: string; alleles: string };
type RawAnn = { vrs_id: string; key: string; val_arr_str: string; val_arr_num: string };

const unwrap = (s?: string) => (s ?? '').replace(/^\[|\]$/g, '').trim();
const toVariant = (v: RawVariant): Variant => ({
  vrsId: v.vrs_id, gene: v.gene, chrom: v.chrom, pos: v.start, ref: v.ref, alt: unwrap(v.alleles),
});

export const isGwasRole = (roles: string[]) => roles.some(r => /gwas|polygenic/i.test(r));

/**
 * Established IBD risk-pathway genes from GWAS (innate sensing and autophagy,
 * IL-23/Th17, cytokine signalling, epithelial barrier). Used to fetch the
 * common background variation the section hides by default.
 */
export const IBD_PATHWAY_GENES = [
  'NOD2', 'ATG16L1', 'IRGM', 'LRRK2', 'CARD9', 'LACC1', 'XBP1',
  'IL23R', 'IL12B', 'JAK2', 'TYK2', 'STAT3', 'STAT4', 'CCR6', 'TNFSF15',
  'IL10', 'IL18RAP', 'PTPN2', 'PTPN22', 'SMAD3', 'ICOSLG', 'NKX2-3', 'ZNF365',
  'MST1', 'FUT2', 'HNF4A', 'ECM1', 'CDH1', 'RNF186', 'GPR35',
];

export interface Progress { step: string; done: number; total: number }

/**
 * The child's variants under `q`, annotated, with genotype and which parent
 * also carries each one.
 */
export async function loadFindings(patientId: string, q: GenomicsQuery, onProgress?: (p: Progress) => void): Promise<Annotated[]> {
  const rare = {
    frequency: { operator: '<', value: q.maxAf },
    ...(q.classes.length ? { pathogenicity: q.classes } : {}),
  };
  // Background variation in established IBD risk-pathway genes. A frequency
  // filter can't find it: in this data set most of these variants carry no
  // gnomAD frequency or classification, so they are fetched by gene.
  const common = { genes: IBD_PATHWAY_GENES };
  // The frequency filter drops variants absent from gnomAD (no frequency at
  // all), which include the most interesting ones. Pathogenic and likely
  // pathogenic calls are therefore also fetched with no frequency limit.
  const severe = q.classes.filter(c => c === 'Pathogenic' || c === 'Likely_pathogenic');
  const severeAnyAf = severe.length && q.maxAf < 1 ? { pathogenicity: severe } : null;
  const forWho = (body: object, ref: string) => ({ ...body, patient_refs: [ref] });
  const path = '/query/variant?offset=0&limit=1000';
  const jobs: [string, object][] = [
    ['child', forWho(rare, patientId)],
    ['mother', forWho(rare, `${patientId}-M`)],
    ['father', forWho(rare, `${patientId}-F`)],
    ...(severeAnyAf ? [
      ['childSevere', forWho(severeAnyAf, patientId)],
      ['motherSevere', forWho(severeAnyAf, `${patientId}-M`)],
      ['fatherSevere', forWho(severeAnyAf, `${patientId}-F`)],
    ] as [string, object][] : []),
    ...(q.includeCommonIbd ? [
      ['childCommon', forWho(common, patientId)],
      ['motherCommon', forWho(common, `${patientId}-M`)],
      ['fatherCommon', forWho(common, `${patientId}-F`)],
    ] as [string, object][] : []),
  ];
  let done = 0;
  onProgress?.({ step: 'Querying variants for the child and parents', done, total: jobs.length });
  const results = Object.fromEntries(await Promise.all(jobs.map(async ([k, body]) => {
    const r = await runQuery<RawVariant[]>(path, body).catch(() => [] as RawVariant[]);
    onProgress?.({ step: 'Querying variants for the child and parents', done: ++done, total: jobs.length });
    return [k, r] as const;
  }))) as Record<string, RawVariant[]>;

  const byId = new Map<string, { v: Variant; common: boolean }>();
  for (const v of [...(results.child ?? []), ...(results.childSevere ?? [])]) byId.set(v.vrs_id, { v: toVariant(v), common: false });
  for (const v of results.childCommon ?? []) if (!byId.has(v.vrs_id)) byId.set(v.vrs_id, { v: toVariant(v), common: true });
  if (!byId.size) return [];
  const ids = [...byId.keys()];
  const mother = new Set([...(results.mother ?? []), ...(results.motherSevere ?? []), ...(results.motherCommon ?? [])].map(v => v.vrs_id));
  const father = new Set([...(results.father ?? []), ...(results.fatherSevere ?? []), ...(results.fatherCommon ?? [])].map(v => v.vrs_id));

  onProgress?.({ step: `Reading annotations for ${ids.length} variants`, done: 0, total: 1 });
  const ann = await runQuery<RawAnn[]>('/query/annotation?offset=0&limit=20000', {
    vrs_ids: ids, annotations: Object.values(ANN_KEYS).map(key => ({ type: 'key', key })),
  });

  const fields = new Map<string, Record<string, string>>();
  for (const a of ann) {
    const f = fields.get(a.vrs_id) ?? {};
    f[a.key] = unwrap(a.val_arr_str) || unwrap(a.val_arr_num);
    fields.set(a.vrs_id, f);
  }
  const num = (s?: string) => (s && !Number.isNaN(Number(s)) ? Number(s) : undefined);
  const out: Annotated[] = [];
  for (const [id, { v, common }] of byId) {
    const f = fields.get(id) ?? {};
    const roles = (f[ANN_KEYS.ibdRoles] ?? '').split('|').map(s => s.trim()).filter(Boolean);
    const a: Annotated = {
      ...v,
      cls: f[ANN_KEYS.cls] || undefined,
      clinvar: f[ANN_KEYS.clinvar] || undefined,
      af: num(f[ANN_KEYS.af]),
      hgvsp: f[ANN_KEYS.hgvsp] || undefined,
      hgvsc: f[ANN_KEYS.hgvsc] || undefined,
      consequence: f[ANN_KEYS.consequence] || undefined,
      ibdBucket: f[ANN_KEYS.ibdBucket] || undefined,
      ibdRoles: roles,
      omim: f[ANN_KEYS.omim] || undefined,
      revel: num(f[ANN_KEYS.revel]),
      cadd: num(f[ANN_KEYS.cadd]),
      inMother: mother.has(id),
      inFather: father.has(id),
      common,
    };
    // Pathway variants: keep the ones that are not rare findings (common or unannotated).
    if (common && a.af != null && a.af < q.commonAf && a.cls) continue;
    // P/LP calls fetched without a frequency limit: keep novel ones and those under the limit.
    if (!common && a.af != null && a.af >= q.maxAf) continue;
    out.push(a);
  }
  return out;
}

/* ---------- genotype, one variant at a time ---------- */

const gtCache = new Map<string, Promise<string | null>>();

/** The sample's genotype call for one variant (e.g. 0/1), or null. */
export function genotypeOf(vrsId: string, sampleId: string): Promise<string | null> {
  const key = `${vrsId}|${sampleId}`;
  let p = gtCache.get(key);
  if (!p) {
    p = getJson<{ genotype?: string }[]>(`/vcf/variant/${vrsId}/${sampleId}`).then(j => j[0]?.genotype ?? null);
    p.catch(() => gtCache.delete(key));
    gtCache.set(key, p);
  }
  return p;
}

/** Protein-changing or splice consequences (VEP terms). */
export const isCodingOrSplice = (consequence?: string) =>
  /missense|stop_gained|stop_lost|start_lost|frameshift|inframe|protein_altering|splice_acceptor|splice_donor|splice_region|coding_sequence/i.test(consequence ?? '');
