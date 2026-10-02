import { useState } from 'react';
import { Button, CheckBox, Dialog, RadioButton } from 'clinical-primitives';
import { SECTIONS } from '../sections';
import type { Settings, SettingsApi } from '../settings';

/**
 * App-level settings only: which sections are on the dashboard, and theme.
 * Everything specific to a section lives behind the gear in its own header.
 */
export function SectionsMenu({ api }: { api: SettingsApi }) {
  const [open, setOpen] = useState(false);
  const { settings, setLayout, setTheme, reset } = api;
  const hidden = settings.layout.filter(l => !l.visible).length;

  return (
    <>
      <Button variant="neutral" onClick={() => setOpen(true)}>
        Sections{hidden > 0 ? ` (${hidden} hidden)` : ''}
      </Button>
      {open && (
        <Dialog open={open} onClose={() => setOpen(false)} title="Dashboard">
          <div className="settings">
            <h4>Sections</h4>
            <p className="muted">Use the gear on each section to customize it.</p>
            {settings.layout.map(l => (
              <label key={l.id} className="setting-row">
                <CheckBox checked={l.visible} onChange={e => setLayout(l.id, { visible: e.currentTarget.checked })} />
                {SECTIONS[l.id].title}
              </label>
            ))}

            <h4>Theme</h4>
            <RadioButton
              value={settings.theme}
              onChange={v => setTheme(v as Settings['theme'])}
              options={[
                { value: 'system', label: 'System' },
                { value: 'light', label: 'Light' },
                { value: 'dark', label: 'Dark' },
              ]}
            />

            <div className="settings-foot">
              <Button variant="muted" onClick={reset}>Reset everything</Button>
              <Button variant="info" onClick={() => setOpen(false)}>Done</Button>
            </div>
          </div>
        </Dialog>
      )}
    </>
  );
}
