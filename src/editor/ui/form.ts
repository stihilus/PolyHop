import { el } from './dom';

/**
 * Schema-driven settings forms. A "settings screen" is just a list of fields bound to a plain
 * object; the same builder drives the player inspector, block inspector and project settings.
 */
export type Field =
  | { kind: 'section'; label: string }
  | { kind: 'number'; key: string; label: string; min?: number; max?: number; step?: number; unit?: string; hint?: string }
  | { kind: 'bool'; key: string; label: string; hint?: string }
  | { kind: 'text'; key: string; label: string; hint?: string }
  | { kind: 'color'; key: string; label: string; hint?: string }
  | {
      kind: 'select';
      key: string;
      label: string;
      options: { value: string; label: string }[];
      /** Adds a leading "None" option that maps to null. */
      nullable?: boolean;
      noneLabel?: string;
      hint?: string;
    }
  | { kind: 'vec3'; key: string; label: string; step?: number; unit?: string; hint?: string };

type Target = Record<string, unknown>;

function clamp(v: number, min?: number, max?: number): number {
  if (min !== undefined && v < min) return min;
  if (max !== undefined && v > max) return max;
  return v;
}

function numberInput(
  value: number,
  opts: { min?: number; max?: number; step?: number },
  onValue: (v: number) => void,
): HTMLInputElement {
  const input = el('input', {
    type: 'number',
    value: String(round(value)),
    step: opts.step ?? 0.1,
    min: opts.min,
    max: opts.max,
  });
  input.addEventListener('input', () => {
    const v = parseFloat(input.value);
    if (Number.isFinite(v)) onValue(clamp(v, opts.min, opts.max));
  });
  input.addEventListener('change', () => {
    const v = parseFloat(input.value);
    const fixed = Number.isFinite(v) ? clamp(v, opts.min, opts.max) : value;
    input.value = String(round(fixed));
    onValue(fixed);
  });
  return input;
}

function round(v: number): number {
  return Math.round(v * 1000) / 1000;
}

export function buildForm(fields: Field[], target: Target, onChange: (key: string) => void): HTMLElement {
  const root = el('div', { class: 'form' });
  for (const f of fields) {
    if (f.kind === 'section') {
      root.append(el('div', { class: 'form-section', text: f.label }));
      continue;
    }
    const row = el('label', { class: 'form-row', title: f.hint ?? '' });
    // vec3 rows have no room for a trailing unit, so it goes into the label
    const label = f.kind === 'vec3' && f.unit ? `${f.label} (${f.unit})` : f.label;
    row.append(el('span', { class: 'form-label', text: label }));
    const control = el('span', { class: 'form-control' });

    if (f.kind === 'number') {
      control.append(
        numberInput(target[f.key] as number, f, (v) => {
          target[f.key] = v;
          onChange(f.key);
        }),
      );
      if (f.unit) control.append(el('span', { class: 'form-unit', text: f.unit }));
    } else if (f.kind === 'bool') {
      const cb = el('input', { type: 'checkbox', checked: target[f.key] as boolean });
      cb.addEventListener('change', () => {
        target[f.key] = cb.checked;
        onChange(f.key);
      });
      control.append(cb);
    } else if (f.kind === 'text') {
      const input = el('input', { type: 'text', value: String(target[f.key] ?? '') });
      input.addEventListener('input', () => {
        target[f.key] = input.value;
        onChange(f.key);
      });
      control.append(input);
    } else if (f.kind === 'color') {
      const input = el('input', { type: 'color', value: String(target[f.key] ?? '#ffffff') });
      input.addEventListener('input', () => {
        target[f.key] = input.value;
        onChange(f.key);
      });
      control.append(input);
    } else if (f.kind === 'select') {
      const select = el('select', {});
      if (f.nullable) select.append(el('option', { value: '', text: f.noneLabel ?? 'None' }));
      for (const o of f.options) select.append(el('option', { value: o.value, text: o.label }));
      select.value = String(target[f.key] ?? '');
      select.addEventListener('change', () => {
        target[f.key] = select.value === '' && f.nullable ? null : select.value;
        onChange(f.key);
      });
      control.append(select);
    } else if (f.kind === 'vec3') {
      const vec = target[f.key] as number[];
      control.classList.add('vec3');
      (['X', 'Y', 'Z'] as const).forEach((axis, i) => {
        control.append(
          el('span', { class: `axis axis-${axis.toLowerCase()}`, text: axis }),
          numberInput(vec[i]!, { step: f.step }, (v) => {
            vec[i] = v;
            onChange(f.key);
          }),
        );
      });
    }
    row.append(control);
    root.append(row);
  }
  return root;
}
