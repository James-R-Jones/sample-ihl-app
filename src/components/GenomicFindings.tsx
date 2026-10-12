/**
 * Genomic findings: the child's germline variants from the synthetic genomics
 * API, as finding cards, with genotype and which parent carries each one.
 * Filters come from the section's gear (defaults) and the two toggles here.
 */
import { useEffect, useMemo, useState } from 'react';
import type { Patient } from 'fhir/r4';
import { Alert, Button, CheckBox, FindingCard, Loader } from 'clinical-primitives';
import { genotypeOf, isCodingOrSplice, listSamples, loadFindings, type Annotated, type Progress } from '../genomics';
import type { SectionConfigs } from '../settings';

export type GenomicsConfig = SectionConfigs['genomics'];

export const CLASS_OPTIONS = [
  { value: 'Pathogenic', label: 'Pathogenic' },
  { value: 'Likely_pathogenic', label: 'Likely pathogenic' },
  { value: 'Conflicting_classifications_of_pathogenicity', label: 'Conflicting' },
  { value: 'VUS', label: 'VUS' },
  { value: 'Likely_benign', label: 'Likely benign' },
  { value: 'Benign', label: 'Benign' },
];
export const AF_OPTIONS = [
  { value: 0.001, label: '< 0.1%' },
  { value: 0.01, label: '< 1%' },
  { value: 0.05, label: '< 5%' },
  { value: 1, label: 'Any' },
];
const COMMON_AF = 0.01;

const CLASS_RANK: Record<string, number> = {
  Pathogenic: 0, Likely_pathogenic: 1, Conflicting_classifications_of_pathogenicity: 2, VUS: 3,
};
const pretty = (s?: string) => (s ?? '').replace(/_/g, ' ').replace(/\bvariant\b/g, '').replace(/\s+/g, ' ').trim();
const classLabel = (s?: string) => CLASS_OPTIONS.find(c => c.value === s)?.label ?? (pretty(s) || 'Unclassified');
const isMonogenic = (v: Annotated) => v.ibdRoles.some(r => /monogenic|veo/i.test(r));

const ROLE_LABELS: Record<string, string> = {
  bolton_high_penetrance_monogenic: 'High-penetrance monogenic IBD gene',
  bolton_moderate_penetrance_monogenic: 'Moderate-penetrance monogenic IBD gene',
  bolton_polygenic_gwas_confident: 'IBD GWAS risk gene (confident)',
  bolton_polygenic_gwas_additional: 'IBD GWAS risk gene (additional)',
  consensus_gwas_anchor: 'Consensus IBD GWAS anchor gene',
  existing_veo_ibd_dx: 'On a very-early-onset IBD diagnostic panel',
  existing_ibd_dx_taxonomy: 'In an IBD diagnostic gene list',
  existing_treatment_target: 'Treatment target',
  existing_pgx: 'Pharmacogenomic relevance',
  existing_taxonomy_review: 'Flagged for taxonomy review',
  gemini_monogenic: 'Monogenic (model-curated)',
};
const roleLabel = (r: string) => ROLE_LABELS[r] ?? pretty(r);

function fmtAf(af?: number) {
  if (af == null) return 'not in gnomAD';
  if (af === 0) return '0 (absent)';
  const pct = af * 100;
  return `${pct < 0.01 ? pct.toPrecision(2) : pct.toFixed(pct < 1 ? 3 : 1)}% (${af.toExponential(1)})`;
}
const change = (v: Annotated) =>
  v.hgvsp?.split(':')[1] ?? v.hgvsc?.split(':')[1] ?? `${v.chrom}:${v.pos} ${v.ref}>${v.alt}`;

function zygosity(v: Annotated, male: boolean, g: string | null | undefined) {
  if (g === undefined) return 'genotype loading';
  g = g ?? '';
  if (/^(1[/|]1)$/.test(g)) return /x$/i.test(v.chrom) && male ? 'hemizygous' : 'homozygous';
  if (/^(0[/|]1|1[/|]0)$/.test(g)) return 'heterozygous';
  return g ? `genotype ${g}` : 'genotype not available';
}
function inheritance(v: Annotated) {
  if (v.inMother && v.inFather) return 'both parents carry it';
  if (v.inMother) return 'inherited from the mother';
  if (v.inFather) return 'inherited from the father';
  return 'not called in either parent';
}

function Card({ v, male, sample }: { v: Annotated; male: boolean; sample: string }) {
  const [gt, setGt] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    let live = true;
    genotypeOf(v.vrsId, sample).then(g => live && setGt(g), () => live && setGt(null));
    return () => { live = false; };
  }, [v.vrsId, sample]);
  const pathogenic = v.cls === 'Pathogenic' || v.cls === 'Likely_pathogenic';
  const concern = pathogenic ? 'high' : (!v.common && isMonogenic(v) && isCodingOrSplice(v.consequence) ? 'moderate' : 'low');
  const zyg = zygosity(v, male, gt);
  return (
    <FindingCard
      title={<span>{v.gene} <span className="genomic-change">{change(v)}</span></span>}
      description={`${classLabel(v.cls)} · ${pretty(v.consequence) || 'consequence not annotated'} · ${zyg}, ${inheritance(v)}`}
      concernLevel={concern}
      evidenceTabs={[
        {
          label: 'Variant',
          items: [{
            kind: 'score',
            name: 'Classification',
            total: classLabel(v.cls),
            components: [
              { label: 'ClinVar', value: pretty(v.clinvar) || 'not in ClinVar' },
              { label: 'gnomAD frequency', value: fmtAf(v.af) },
              { label: 'Consequence', value: pretty(v.consequence) || 'n/a' },
              ...(v.hgvsc ? [{ label: 'cDNA', value: v.hgvsc }] : []),
              ...(v.hgvsp ? [{ label: 'Protein', value: v.hgvsp }] : []),
              { label: 'Position (GRCh38)', value: `${v.chrom}:${v.pos} ${v.ref}>${v.alt}` },
              ...(v.revel != null ? [{ label: 'REVEL', value: v.revel.toFixed(2) }] : []),
              ...(v.cadd != null ? [{ label: 'CADD', value: v.cadd.toFixed(1) }] : []),
            ],
          }],
        },
        {
          label: 'IBD relevance',
          items: [
            { kind: 'narrative', text: v.ibdBucket ? `IBD taxonomy: ${v.ibdBucket}.` : 'Not in the IBD gene taxonomy.' },
            ...(v.ibdRoles.length ? [{ kind: 'narrative' as const, text: v.ibdRoles.map(roleLabel).join('; ') + '.' }] : []),
            ...(v.omim ? [{ kind: 'narrative' as const, text: `OMIM: ${v.omim}` }] : []),
          ],
        },
        {
          label: 'Family',
          items: [{ kind: 'narrative', text: `Sample ${sample}: ${zyg}${gt ? ` (${gt})` : ''}; ${inheritance(v)}. Mother: ${v.inMother ? 'carrier' : 'not called'}. Father: ${v.inFather ? 'carrier' : 'not called'}.` }],
        },
      ]}
    />
  );
}

const memo = new Map<string, Promise<Annotated[]>>();

export function GenomicFindings({ patient, config }: { patient: Patient; config: GenomicsConfig }) {
  const [ibdOnly, setIbdOnly] = useState(config.ibdGenesOnly);
  const [hideCommon, setHideCommon] = useState(config.hideCommonIbd);
  const [codingOnly, setCodingOnly] = useState(config.codingOnly);
  const [limit, setLimit] = useState(config.pageSize);
  const [sample, setSample] = useState<string | null | undefined>(undefined);
  const [state, setState] = useState<{ status: 'loading' | 'ready' | 'error'; data?: Annotated[]; error?: string; progress?: Progress }>({ status: 'loading' });
  const male = patient.gender === 'male';
  const id = patient.id!;

  useEffect(() => {
    let live = true;
    listSamples().then(
      ss => live && setSample(ss.find(s => s.subject === id)?.sampleId ?? null),
      e => live && setState({ status: 'error', error: String(e?.message ?? e) }),
    );
    return () => { live = false; };
  }, [id]);

  const query = useMemo(() => ({
    maxAf: config.maxAf, classes: config.classes, includeCommonIbd: !hideCommon, commonAf: COMMON_AF,
  }), [config.maxAf, config.classes, hideCommon]);

  useEffect(() => {
    if (!sample) return;
    let live = true;
    const key = `${id}|${JSON.stringify(query)}`;
    let p = memo.get(key);
    if (!p) {
      p = loadFindings(id, query, progress => live && setState(s => ({ ...s, status: 'loading', progress })));
      p.catch(() => memo.delete(key));
      memo.set(key, p);
    }
    setState(s => ({ status: 'loading', progress: s.progress }));
    p.then(
      data => live && setState({ status: 'ready', data }),
      e => live && setState({ status: 'error', error: String(e?.message ?? e) }),
    );
    return () => { live = false; };
  }, [sample, id, query]);

  const pathway = useMemo(() => {
    const groups = new Map<string, Annotated[]>();
    for (const v of state.data ?? []) if (v.common) groups.set(v.gene, [...(groups.get(v.gene) ?? []), v]);
    return [...groups.entries()].sort((a, b) => b[1].length - a[1].length);
  }, [state.data]);

  const shown = useMemo(() => (state.data ?? [])
    .filter(v => !v.common)
    .filter(v => !ibdOnly || !!v.ibdBucket)
    .filter(v => !codingOnly || isCodingOrSplice(v.consequence) || v.cls === 'Pathogenic' || v.cls === 'Likely_pathogenic')
    .filter(v => !config.classes.length || (v.cls && config.classes.includes(v.cls)) || (v.clinvar && config.classes.includes(v.clinvar)))
    .sort((a, b) =>
      (CLASS_RANK[a.cls ?? ''] ?? 9) - (CLASS_RANK[b.cls ?? ''] ?? 9)
      || Number(isCodingOrSplice(b.consequence)) - Number(isCodingOrSplice(a.consequence))
      || Number(isMonogenic(b)) - Number(isMonogenic(a))
      || (a.af ?? 0) - (b.af ?? 0)),
  [state.data, ibdOnly, codingOnly, config.classes]);

  if (sample === null) {
    return <p className="muted">No genomic sample for this patient. The synthetic genomics test set covers the 10 patients in the SMART Cumulus Synthetic IBD v2 cohort.</p>;
  }
  const afLabel = AF_OPTIONS.find(o => o.value === config.maxAf)?.label ?? `< ${config.maxAf * 100}%`;
  const counts = {
    p: shown.filter(v => v.cls === 'Pathogenic' || v.cls === 'Likely_pathogenic').length,
    common: pathway.reduce((n, [, vs]) => n + vs.length, 0),
  };

  return (
    <div className="genomics">
      <div className="genomics-head">
        <span className="muted">
          {sample ? <>Sample <b>{sample}</b> with both parents · </> : null}
          gnomAD {afLabel} · {config.classes.length ? config.classes.map(classLabel).join(', ') : 'any classification'}
        </span>
        <span className="genomics-toggles">
          <label className="setting-row">
            <CheckBox checked={ibdOnly} onChange={e => { const on = e.currentTarget.checked; setIbdOnly(on); }} />
            IBD genes only
          </label>
          <label className="setting-row" title="Missense, nonsense, frameshift, in-frame and splice variants. Pathogenic calls always show.">
            <CheckBox checked={codingOnly} onChange={e => { const on = e.currentTarget.checked; setCodingOnly(on); }} />
            Protein-changing and splice only
          </label>
          <label className="setting-row" title="Background variation (common or unannotated) in established IBD risk-pathway genes such as NOD2, ATG16L1, IL23R and IRGM">
            <CheckBox checked={hideCommon} onChange={e => { const on = e.currentTarget.checked; setHideCommon(on); }} />
            Hide common variants in known IBD pathways
          </label>
        </span>
      </div>

      {state.status === 'error' && <Alert variant="danger">Could not load genomic data: {state.error}</Alert>}
      {(state.status === 'loading' || sample === undefined) && (
        <div className="genomics-loading">
          <Loader />
          <span className="muted">
            {state.progress ? `${state.progress.step} (${state.progress.done}/${state.progress.total})…` : 'Finding this patient’s sample…'}
            {' '}The first load of a patient takes about 30 seconds; repeats are quick.
          </span>
        </div>
      )}
      {state.status === 'ready' && (
        <>
          <p className="genomics-summary">
            <b>{shown.length}</b> variant{shown.length === 1 ? '' : 's'} match
            {counts.p > 0 && <> · <b>{counts.p}</b> pathogenic or likely pathogenic</>}

          </p>
          {shown.length === 0 && <p className="muted">No variants pass these filters. Widen the frequency or classification filters in the gear.</p>}
          <div className="genomics-cards">
            {shown.slice(0, limit).map(v => <Card key={v.vrsId} v={v} male={male} sample={sample!} />)}
          </div>
          {shown.length > limit && (
            <Button variant="muted" onClick={() => setLimit(l => l + config.pageSize)}>Show more ({shown.length - limit} remaining)</Button>
          )}
          {!hideCommon && <PathwayVariants groups={pathway} total={counts.common} />}
          <p className="muted genomics-foot">
            Synthetic germline data from the IHL genomics test API (joint VCF, GRCh38), not for clinical use.
            Classification is the pipeline's final tier (IHL_CLASS); IBD relevance comes from its IBD gene taxonomy.
            The frequency filter cannot keep variants absent from gnomAD, so novel variants appear only when classed
            pathogenic or likely pathogenic.
          </p>
        </>
      )}
    </div>
  );
}

const LOF = /stop_gained|frameshift|splice_acceptor|splice_donor|start_lost/i;

/** Background variants in IBD risk-pathway genes, grouped by gene. */
function PathwayVariants({ groups, total }: { groups: [string, Annotated[]][]; total: number }) {
  const [open, setOpen] = useState<string | null>(null);
  return (
    <div className="genomics-pathway">
      <h4 className="muted-label">Common or unannotated variants in IBD risk-pathway genes ({total})</h4>
      {total === 0 ? <p className="muted">None in this sample.</p> : (
        <>
          <div className="genomics-pathway-genes">
            {groups.map(([gene, vs]) => (
              <button key={gene} type="button" className={`chip${open === gene ? ' chip--on' : ''}${vs.some(v => LOF.test(v.consequence ?? '')) ? ' chip--lof' : ''}`} onClick={() => setOpen(open === gene ? null : gene)}
                title={vs.some(v => LOF.test(v.consequence ?? '')) ? 'Includes a predicted loss-of-function change' : undefined}>
                {gene} <b>{vs.length}</b>
              </button>
            ))}
          </div>
          {open && (
            <table className="genomics-pathway-table">
              <thead><tr><th>Position (GRCh38)</th><th>Change</th><th>gnomAD</th><th>Consequence</th><th>Parents</th></tr></thead>
              <tbody>
                {(groups.find(([g]) => g === open)?.[1] ?? []).sort((a, b) => a.pos - b.pos).map(v => (
                  <tr key={v.vrsId}>
                    <td>{v.chrom}:{v.pos}</td>
                    <td className="genomic-change">{v.hgvsp?.split(':')[1] ?? v.hgvsc?.split(':')[1] ?? `${v.ref}>${v.alt}`}</td>
                    <td>{v.af == null ? <span className="muted">not annotated</span> : fmtAf(v.af)}</td>
                    <td>
                      {pretty(v.consequence) || <span className="muted">not annotated</span>}
                      {LOF.test(v.consequence ?? '') && <span className="lof-flag"> predicted loss of function</span>}
                    </td>
                    <td>{inheritance(v)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p className="muted genomics-foot">
            Most of these variants carry no frequency or classification in the test data, so they are listed rather than
            assessed. Common variants in these genes add small amounts of polygenic risk; none is diagnostic on its own.
          </p>
        </>
      )}
    </div>
  );
}
