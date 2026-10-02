import type { ReactNode } from 'react';
import { Highlight } from './Highlight';

/**
 * Renders a plain-text clinical note. Notes in this cohort use a light
 * Markdown style ("# Heading", "- item"), so headings and bullet lists are
 * recognised; everything else is shown as text. Built as React elements, never
 * as HTML, so note content cannot inject markup.
 */
export function NoteText({ text, terms = [] }: { text: string; terms?: string[] }) {
  const hl = (t: string) => <Highlight text={t} terms={terms} />;
  const out: ReactNode[] = [];
  let bullets: string[] = [];
  const flush = () => {
    if (bullets.length) out.push(<ul key={out.length}>{bullets.map((b, i) => <li key={i}>{hl(b)}</li>)}</ul>);
    bullets = [];
  };
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trimEnd();
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    const b = line.match(/^\s*[-*]\s+(.*)$/);
    if (b) { bullets.push(b[1]); continue; }
    flush();
    if (h) out.push(h[1].length <= 2
      ? <h4 key={out.length}>{hl(h[2])}</h4>
      : <h5 key={out.length}>{hl(h[2])}</h5>);
    else if (line.trim()) out.push(<p key={out.length}>{hl(line)}</p>);
  }
  flush();
  return <div className="note-text">{out}</div>;
}
