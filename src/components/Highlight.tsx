/** Wraps every occurrence of any term in <mark>, case-insensitively. */
export function Highlight({ text, terms }: { text: string; terms: string[] }) {
  if (!terms.length) return <>{text}</>;
  const escaped = terms.map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const parts = text.split(new RegExp(`(${escaped.join('|')})`, 'gi'));
  return (
    <>
      {parts.map((p, i) => (i % 2 === 1 ? <mark key={i} className="hl">{p}</mark> : p))}
    </>
  );
}
