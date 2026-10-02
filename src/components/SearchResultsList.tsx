import { Badge } from 'clinical-primitives';
import { fmtDate } from '../encounter';
import { fieldLabel, snippet, type SearchResult } from '../search';
import { Highlight } from './Highlight';

/** Result rows: type, title, date, and up to two highlighted snippets. */
export function SearchResultsList({ results, terms, onOpen }: {
  results: SearchResult[];
  terms: string[];
  onOpen: (r: SearchResult) => void;
}) {
  return (
    <ul className="search-results">
      {results.map(r => (
        <li key={`${r.resource.resourceType}/${r.resource.id}`}>
          <button type="button" className="search-result" onClick={() => onOpen(r)}>
            <span className="search-result-head">
              <Badge variant="neutral">{r.resource.resourceType}</Badge>
              <span className="search-result-title"><Highlight text={r.title} terms={terms} /></span>
              {r.date && <span className="search-result-date">{fmtDate(r.date)}</span>}
            </span>
            {r.hits.slice(0, 2).map((h, i) => (
              <span key={i} className="search-result-snippet">
                <span className="search-result-field">{fieldLabel(h.field.path)}:</span>{' '}
                <Highlight text={snippet(h.field.text, h.terms)} terms={terms} />
              </span>
            ))}
            {r.hits.length > 2 && <span className="search-result-more">+{r.hits.length - 2} more matching fields</span>}
          </button>
        </li>
      ))}
    </ul>
  );
}

/** "Type/id" key for a result, as used in links. */
export const resultKey = (r: SearchResult) => `${r.resource.resourceType}/${r.resource.id}`;
