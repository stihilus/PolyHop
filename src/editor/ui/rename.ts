/**
 * Rename in place: an input appears over `host` (usually the label of a list row). Enter or leaving the
 * field applies the new name, Escape cancels. The input lives on <body> rather than inside the row so
 * it works even when the row is a <button>.
 */
export function renameInline(host: HTMLElement, current: string, commit: (name: string) => void): void {
  const r = host.getBoundingClientRect();
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'rename-input';
  input.value = current;
  input.style.left = `${Math.max(0, r.left - 4)}px`;
  input.style.top = `${r.top - 3}px`;
  input.style.width = `${Math.max(r.width + 8, 140)}px`;
  input.style.height = `${r.height + 6}px`;
  document.body.append(input);
  input.focus();
  input.select();

  let done = false;
  const finish = (save: boolean) => {
    if (done) return;
    done = true;
    const value = input.value.trim();
    input.remove();
    if (save && value && value !== current) commit(value);
  };
  input.addEventListener('keydown', (e) => {
    e.stopPropagation(); // the editor's own shortcuts must not see the typing
    if (e.key === 'Enter') finish(true);
    else if (e.key === 'Escape') finish(false);
  });
  input.addEventListener('blur', () => finish(true));
  for (const type of ['pointerdown', 'click', 'dblclick'] as const) input.addEventListener(type, (e) => e.stopPropagation());
}
