import { useState } from 'react';
import { Badge, Button, Dialog, SourceDialog } from 'clinical-primitives';
import { attachmentText, fmtDate } from '../encounter';
import { fieldLabel, type SearchResult } from '../search';
import { EncounterDetail } from './EncounterDetail';
import { Highlight } from './Highlight';
import { NoteText } from './NoteText';

type Res = { resourceType: string; id?: string; [k: string]: any };

/** The encounter a resource belongs to, or the resource itself if it is one. */
function encounterIdOf(r: Res): string | undefined {
  if (r.resourceType === 'Encounter') return r.id;
  const ref = r.encounter?.reference ?? r.context?.encounter?.[0]?.reference ?? r.context?.reference;
  return ref?.match(/Encounter\/([^/]+)$/)?.[1];
}

/**
 * Details for one search result: every matching field with highlights, the
 * full note text when the match is in a note, the raw source, and the visit
 * the resource belongs to.
 */
export function SearchResultDialog({ result, terms, resources, onClose }: {
  result: SearchResult;
  terms: string[];
  resources: Record<string, unknown[]>;
  onClose: () => void;
}) {
  const [view, setView] = useState<'detail' | 'visit'>('detail');
  const [source, setSource] = useState(false);
  const r = result.resource;
  const encounterId = encounterIdOf(r);
  const notes = [
    ...(r.content ?? []).map((c: Res) => c.attachment),
    ...(r.presentedForm ?? []),
  ].map(attachmentText).filter((t): t is string => !!t);
  const fieldHits = result.hits.filter(h => h.field.path !== 'note');

  return (
    <>
      <Dialog open onClose={onClose} title={view === 'visit' ? 'Visit' : r.resourceType} style={{ width: 'min(860px, 94vw)' }}>
        <div className="result-dialog">
          {view === 'visit' && encounterId ? (
            <>
              <div><Button variant="muted" onClick={() => setView('detail')}>← Back to result</Button></div>
              <EncounterDetail encounterId={encounterId} resources={resources} highlight={terms} />
            </>
          ) : (
            <>
              <header className="result-dialog-head">
                <div>
                  <h2><Highlight text={result.title} terms={terms} /></h2>
                  <div className="muted">
                    <Badge variant="neutral">{r.resourceType}</Badge>
                    {result.detail && <> · <Highlight text={result.detail} terms={terms} /></>}
                    {result.date && <> · {fmtDate(result.date)}</>}
                  </div>
                </div>
                <div className="result-dialog-actions">
                  {encounterId && r.resourceType !== 'Encounter' && (
                    <Button variant="muted" onClick={() => setView('visit')}>Show visit</Button>
                  )}
                  {r.resourceType === 'Encounter' && (
                    <Button variant="muted" onClick={() => setView('visit')}>Show visit details</Button>
                  )}
                  <Button variant="muted" onClick={() => setSource(true)}>Source</Button>
                </div>
              </header>

              {fieldHits.length > 0 && (
                <section>
                  <h3 className="encounter-subhead">Matching fields ({fieldHits.length})</h3>
                  <dl className="result-fields">
                    {fieldHits.map((h, i) => (
                      <div key={i}>
                        <dt>{fieldLabel(h.field.path)}</dt>
                        <dd><Highlight text={h.field.text} terms={terms} /></dd>
                      </div>
                    ))}
                  </dl>
                </section>
              )}

              {notes.length > 0 && (
                <section>
                  <h3 className="encounter-subhead">Note</h3>
                  {notes.map((t, i) => <NoteText key={i} text={t} terms={terms} />)}
                </section>
              )}
            </>
          )}
        </div>
      </Dialog>
      {source && (
        <SourceDialog open onClose={() => setSource(false)} resource={r} title={`${r.resourceType}/${r.id}`} />
      )}
    </>
  );
}
