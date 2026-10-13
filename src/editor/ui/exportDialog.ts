import { el } from './dom';
import { openModal } from './modal';
import type { ExportOptions } from '../../core/exportPackage';

/** Asks how the game should look in its page, then calls `onExport`. */
export function openExportDialog(title: string, initial: ExportOptions, onExport: (options: ExportOptions) => Promise<string>): void {
  const options: ExportOptions = { ...initial };
  const status = el('div', { class: 'muted', text: '' });

  const controls = el('input', { type: 'checkbox', checked: options.showControls });
  controls.addEventListener('change', () => {
    options.showControls = controls.checked;
  });
  const color = el('input', { type: 'color', value: options.background });
  color.addEventListener('input', () => {
    options.background = color.value;
  });
  const row = (label: string, control: HTMLElement, hint = '') =>
    el('label', { class: 'form-row', title: hint }, el('span', { class: 'form-label', text: label }), el('span', { class: 'form-control' }, control));

  const content = el(
    'div',
    { class: 'form' },
    el('div', { class: 'empty', text: `“${title}” becomes a zip with index.html, the game player and the font. Upload the zip to itch.io as an HTML5 game, or unzip it anywhere and open index.html.` }),
    row('Show controls', controls, 'List the keys on the start screen'),
    row('Page color', color, 'The color around the game'),
    status,
  );
  openModal('Export game (HTML5)', content, [
    { label: 'Cancel' },
    {
      label: 'Export .zip',
      primary: true,
      onClick: () => {
        status.textContent = 'Building…';
        void onExport(options).then(
          (msg) => {
            status.textContent = msg;
          },
          (err) => {
            status.textContent = `Export failed: ${err instanceof Error ? err.message : err}`;
          },
        );
        return false; // keep the dialog open to show the result
      },
    },
  ]);
}
