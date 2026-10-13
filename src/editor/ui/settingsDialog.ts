import { ACTION_LABELS, keyLabel } from '../../core/keys';
import {
  DEFAULT_SPLASH_SECONDS,
  MAX_SPLASH_CHARS,
  MAX_SPLASH_SECONDS,
  MIN_SPLASH_SECONDS,
  fitSplash,
  isImageDataUrl,
} from '../../core/splash';
import { ACTIONS, DEFAULT_CONTROLS, RENDER_SCALES } from '../../core/types';
import { showSplash } from '../../runtime/splash';
import type { Store } from '../store';
import { el } from './dom';
import { type Field, buildForm } from './form';

export { keyLabel };

const SETTINGS_FIELDS: Field[] = [
  { kind: 'section', label: 'Project' },
  { kind: 'text', key: 'name', label: 'Game title', hint: 'Shown as the page title of the exported game' },
  { kind: 'bool', key: 'fullscreen', label: 'Start fullscreen', hint: 'Requests fullscreen when the game starts' },
  { kind: 'section', label: 'Input' },
  { kind: 'number', key: 'mouseSensitivity', label: 'Mouse sensitivity', min: 0.1, max: 5, step: 0.1 },
  { kind: 'bool', key: 'invertY', label: 'Invert camera Y' },
  { kind: 'bool', key: 'gamepad', label: 'Gamepad support' },
];

/** The project settings form; the music list comes from the project's sounds. */
function settingsFields(store: Store): Field[] {
  const music = store.project.sounds.filter((s) => s.kind !== 'sfx').map((s) => ({ value: s.id, label: s.name }));
  return [
    ...SETTINGS_FIELDS,
    { kind: 'section', label: 'Sound' },
    { kind: 'select', key: 'music', label: 'Music', nullable: true, noneLabel: 'None', options: music, hint: 'A loop that plays while the game runs. Make one in the Audio tab.' },
    { kind: 'number', key: 'volume', label: 'Volume', min: 0, max: 1, step: 0.1, hint: 'Master volume of the whole game' },
  ];
}

/** Read a picture file as a data URL that fits the limits of a splash screen (brought down in size when it is big). */
async function readSplashFile(file: File): Promise<string> {
  const original = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error('could not read the file'));
    reader.readAsDataURL(file);
  });
  const img = new Image();
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error('this file is not a picture the browser can show'));
    img.src = original;
  });
  const fit = fitSplash(img.naturalWidth, img.naturalHeight);
  const small = fit.width === img.naturalWidth && fit.height === img.naturalHeight;
  if (small && isImageDataUrl(original)) return original;
  const canvas = document.createElement('canvas');
  canvas.width = fit.width;
  canvas.height = fit.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('could not resize the picture');
  ctx.imageSmoothingEnabled = fit.width * 2 > img.naturalWidth; // a pixel picture stays crisp when it is made smaller by little
  ctx.drawImage(img, 0, 0, fit.width, fit.height);
  const png = canvas.toDataURL('image/png');
  const out = png.length > MAX_SPLASH_CHARS * 0.8 ? canvas.toDataURL('image/jpeg', 0.88) : png;
  if (!isImageDataUrl(out)) throw new Error('the picture is too big: use a smaller one');
  return out;
}

export function openSettingsDialog(store: Store): void {
  const settings = store.project.settings;
  const backdrop = el('div', { class: 'modal-backdrop' });
  const dialog = el('div', { class: 'modal' });
  backdrop.append(dialog);

  const close = () => {
    document.removeEventListener('keydown', onEsc, true);
    backdrop.remove();
  };
  const onEsc = (e: KeyboardEvent) => {
    if (e.code === 'Escape' && !capturing) {
      e.stopPropagation();
      close();
    }
  };
  document.addEventListener('keydown', onEsc, true);
  backdrop.addEventListener('mousedown', (e) => {
    if (e.target === backdrop) close();
  });

  let capturing = false;

  const controlsTable = el('div', { class: 'controls-table' });
  const renderControls = () => {
    controlsTable.replaceChildren();
    for (const action of ACTIONS) {
      const btn = el('button', { class: 'key-btn', text: settings.controls[action].map(keyLabel).join('  /  ') || '—' });
      btn.addEventListener('click', (ev) => {
        const add = ev.shiftKey;
        btn.textContent = 'Press a key…';
        btn.classList.add('capturing');
        capturing = true;
        const onKey = (e: KeyboardEvent) => {
          e.preventDefault();
          e.stopPropagation();
          document.removeEventListener('keydown', onKey, true);
          capturing = false;
          if (e.code !== 'Escape') {
            const list = add ? settings.controls[action] : [];
            if (!list.includes(e.code)) list.push(e.code);
            settings.controls[action] = list;
            store.settingsChanged();
          }
          renderControls();
        };
        document.addEventListener('keydown', onKey, true);
      });
      controlsTable.append(el('div', { class: 'controls-row' }, el('span', { text: ACTION_LABELS[action] }), btn));
    }
  };
  renderControls();

  // the render scale is a number, the select works with text
  const graphics = { renderScale: String(settings.renderScale) };
  const graphicsFields: Field[] = [
    { kind: 'section', label: 'Graphics' },
    {
      kind: 'select',
      key: 'renderScale',
      label: 'Resolution',
      options: [
        { value: '1', label: 'Full (sharp)' },
        { value: '0.5', label: 'Half (chunky pixels)' },
        { value: '0.34', label: 'Third (very chunky)' },
        { value: '0.25', label: 'Quarter (retro)' },
      ],
      hint: 'How finely the game is drawn while playing and in the exported game. Lower = bigger visible pixels, like old games.',
    },
  ];

  // ---- splash screen: a picture shown when the exported game starts
  const splashBox = el('div', { class: 'splash-settings' });
  const renderSplash = () => {
    splashBox.replaceChildren();
    const splash = settings.splash;
    const preview = el('div', { class: 'splash-preview' });
    if (splash) {
      const img = el('img', { src: splash.image, alt: 'Splash screen' });
      preview.style.background = splash.background;
      preview.append(img);
    } else {
      preview.append(el('span', { class: 'muted', text: 'No picture' }));
    }
    const note = el('div', { class: 'muted', text: 'Shown full screen when the game starts, before the start screen. A click or a key skips it. Up to 1280 × 720; bigger pictures are made smaller.' });
    const file = el('input', { type: 'file', accept: 'image/png,image/jpeg,image/gif,image/webp' });
    file.style.display = 'none';
    file.addEventListener('change', async () => {
      const f = file.files?.[0];
      if (!f) return;
      try {
        const image = await readSplashFile(f);
        settings.splash = {
          image,
          seconds: settings.splash?.seconds ?? DEFAULT_SPLASH_SECONDS,
          background: settings.splash?.background ?? '#000000',
        };
        store.settingsChanged();
        renderSplash();
      } catch (err) {
        alert(`Could not use this picture: ${err instanceof Error ? err.message : err}`);
      }
    });
    const buttons = el(
      'div',
      { class: 'button-stack row' },
      el('button', { class: 'btn', text: splash ? 'Change picture…' : 'Choose picture…', onclick: () => file.click() }),
      ...(splash
        ? [
            el('button', {
              class: 'btn',
              text: 'Preview',
              title: 'Show it as it will look when the game starts',
              onclick: () => {
                const host = el('div', { class: 'splash-preview-host' });
                Object.assign(host.style, { position: 'fixed', inset: '0', zIndex: '2000' });
                document.body.append(host);
                showSplash(host, settings.splash!, () => host.remove());
              },
            }),
            el('button', {
              class: 'btn danger',
              text: 'Remove',
              onclick: () => {
                delete settings.splash;
                store.settingsChanged();
                renderSplash();
              },
            }),
          ]
        : []),
    );
    splashBox.append(preview, buttons, file);
    if (splash) {
      splashBox.append(
        buildForm(
          [
            { kind: 'number', key: 'seconds', label: 'Stays', min: MIN_SPLASH_SECONDS, max: MAX_SPLASH_SECONDS, step: 0.5, unit: 's', hint: 'How long the picture is shown (a click or a key skips it)' },
            { kind: 'color', key: 'background', label: 'Background', hint: 'The color around the picture when it does not fill the screen' },
          ],
          splash as unknown as Record<string, unknown>,
          () => {
            store.settingsChanged();
            preview.style.background = splash.background;
          },
        ),
      );
    }
    splashBox.append(note);
  };
  renderSplash();

  dialog.append(
    el('div', { class: 'modal-title' }, el('span', { text: 'Project Settings' }), el('button', { class: 'icon-btn', text: '✕', onclick: close })),
    buildForm(settingsFields(store), settings as unknown as Record<string, unknown>, () => store.settingsChanged()),
    buildForm(graphicsFields, graphics as unknown as Record<string, unknown>, () => {
      const n = parseFloat(graphics.renderScale);
      settings.renderScale = RENDER_SCALES.includes(n) ? n : 1;
      store.settingsChanged();
    }),
    el('div', { class: 'form-section', text: 'Splash screen' }),
    splashBox,
    el('div', { class: 'form-section', text: 'Controls' }),
    controlsTable,
    el(
      'div',
      { class: 'modal-footer' },
      el('span', { class: 'muted', text: 'Click a key to rebind it. Shift+click adds an alternative key.' }),
      el('button', {
        class: 'btn',
        text: 'Reset controls',
        onclick: () => {
          settings.controls = structuredClone(DEFAULT_CONTROLS);
          store.settingsChanged();
          renderControls();
        },
      }),
    ),
  );
  document.body.append(backdrop);
}
