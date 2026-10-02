import { useState, type ReactNode } from 'react';
import { Button, Dialog } from 'clinical-primitives';

const GearIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
  </svg>
);

const CloseIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
    <path d="M18 6 6 18M6 6l12 12" />
  </svg>
);

interface Props {
  title: string;
  /** Section-specific settings; rendered above the layout controls. */
  settings?: ReactNode;
  wide: boolean;
  isFirst: boolean;
  isLast: boolean;
  onWide: (wide: boolean) => void;
  onMove: (dir: -1 | 1) => void;
  onHide: () => void;
  children: ReactNode;
}

/**
 * Frame shared by every dashboard section: a header with the title, a gear
 * that opens this section's own settings in a modal, and a hide button.
 * Changes apply as they are made, so the section updates behind the modal.
 */
export function Section({ title, settings, wide, isFirst, isLast, onWide, onMove, onHide, children }: Props) {
  const [open, setOpen] = useState(false);
  return (
    <section className={`section${wide ? ' section--wide' : ''}`}>
      <header className="section-header">
        <h3 className="section-title">{title}</h3>
        <div className="section-controls">
          <button
            type="button"
            className={`icon-btn${open ? ' icon-btn--active' : ''}`}
            aria-expanded={open}
            aria-label={`${title} settings`}
            data-tooltip="Section settings"
            onClick={() => setOpen(o => !o)}
          ><GearIcon /></button>
          <button
            type="button"
            className="icon-btn"
            aria-label={`Hide ${title}`}
            data-tooltip="Hide section"
            onClick={onHide}
          ><CloseIcon /></button>
        </div>
      </header>

      {open && (
        <Dialog open onClose={() => setOpen(false)} title={`${title} settings`} style={{ width: 'min(640px, 92vw)' }}>
          <div className="section-settings">
            {settings}
            <div className="section-settings-layout">
              <span className="muted-label">Layout</span>
              <Button variant="muted" onClick={() => onWide(!wide)}>{wide ? 'Half width' : 'Full width'}</Button>
              <Button variant="muted" disabled={isFirst} onClick={() => onMove(-1)}>Move up</Button>
              <Button variant="muted" disabled={isLast} onClick={() => onMove(1)}>Move down</Button>
            </div>
          </div>
          <div className="section-settings-foot">
            <Button variant="info" onClick={() => setOpen(false)}>Done</Button>
          </div>
        </Dialog>
      )}

      <div className="section-body">{children}</div>
    </section>
  );
}
