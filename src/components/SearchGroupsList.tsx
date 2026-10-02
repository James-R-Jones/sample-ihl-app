import { Badge } from 'clinical-primitives';
import { groupResults, type SearchResult } from '../search';
import { Highlight } from './Highlight';

const day = (iso?: string) => (iso ? new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : '');

/**
 * One row per matched thing (same type and title), with its count and quick
 * links to the first and most recent occurrence.
 */
export function SearchGroupsList({ results, terms, onOpen, limit }: {
  results: SearchResult[];
  terms: string[];
  onOpen: (r: SearchResult) => void;
  limit?: number;
}) {
  const groups = groupResults(results);
  return (
    <ul className="search-results">
      {groups.slice(0, limit ?? groups.length).map(g => (
        <li key={g.key} className="search-group">
          <button type="button" className="search-group-main" onClick={() => onOpen(g.last ?? g.results[0])}>
            <Badge variant="neutral">{g.type}</Badge>
            <span className="search-result-title"><Highlight text={g.title} terms={terms} /></span>
            <span className="search-result-date">{g.results.length} result{g.results.length === 1 ? '' : 's'}</span>
          </button>
          <span className="search-group-dates">
            {!g.first && <span className="muted">undated</span>}
            {g.first && g.first === g.last && (
              <button type="button" className="date-link" onClick={() => onOpen(g.first!)}>{day(g.first.date)}</button>
            )}
            {g.first && g.last && g.first !== g.last && (
              <>
                <span className="muted">First</span>
                <button type="button" className="date-link" onClick={() => onOpen(g.first!)}>{day(g.first.date)}</button>
                <span className="muted">Latest</span>
                <button type="button" className="date-link" onClick={() => onOpen(g.last!)}>{day(g.last.date)}</button>
              </>
            )}
          </span>
        </li>
      ))}
    </ul>
  );
}

export const groupCount = (results: SearchResult[]) => groupResults(results).length;
export { day as fmtDay };
