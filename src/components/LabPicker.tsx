import { CheckBox } from 'clinical-primitives';
import { LAB_CODES } from '../labs';

/** Checkbox grid of lab presets, keeping the caller's order for kept items. */
export function LabPicker({ value, onChange, label = 'Labs' }: {
  value: string[];
  onChange: (labs: string[]) => void;
  label?: string;
}) {
  const toggle = (key: string) =>
    onChange(value.includes(key) ? value.filter(k => k !== key) : [...value, key]);
  return (
    <fieldset className="setting-group">
      <legend className="muted-label">{label}</legend>
      <div className="lab-picker">
        {Object.entries(LAB_CODES).map(([key, lab]) => (
          <label key={key} className="setting-row">
            <CheckBox checked={value.includes(key)} onChange={() => toggle(key)} />
            {lab.label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}
