import { GAMEPAD_HELP, GAMEPAD_NAMES_NOTE } from '../../core/gamepad';
import { ACTION_LABELS, keyLabel } from '../../core/keys';
import {
  DEFAULT_MENU,
  LOGO_MAX_HEIGHT,
  LOGO_MAX_WIDTH,
  MAX_LABEL_CHARS,
  MAX_LOGO_CHARS,
  MAX_LOGO_SIZE,
  MIN_LOGO_SIZE,
  type MenuScreen,
  normalizeMenu,
  resolveMenu,
} from '../../core/menu';
import {
  DEFAULT_SPLASH_SECONDS,
  MAX_SPLASH_CHARS,
  MAX_SPLASH_SECONDS,
  MIN_SPLASH_SECONDS,
  SPLASH_MAX_HEIGHT,
  SPLASH_MAX_WIDTH,
  fitWithin,
  isImageDataUrl,
} from '../../core/splash';
import { ACTIONS, DEFAULT_CONTROLS, RENDER_SCALES } from '../../core/types';
import { menuBackdrop, menuContent } from '../../runtime/menu';
import { showSplash } from '../../runtime/splash';
import type { Store } from '../store';
import { el } from './dom';
import { appAlert } from './dialogs';
import { buildVariablesPanel } from './logicPanels';
import { type Field, buildForm } from './form';

export { keyLabel };

const GAME_FIELDS: Field[] = [
  { kind: 'section', label: 'Project' },
  { kind: 'text', key: 'name', label: 'Game title', hint: 'Shown as the page title of the exported game, and on the menu when there is no logo' },
  { kind: 'bool', key: 'fullscreen', label: 'Start fullscreen', hint: 'Requests fullscreen when the game starts' },
];

const INPUT_FIELDS: Field[] = [
  { kind: 'section', label: 'Mouse and gamepad' },
  { kind: 'number', key: 'mouseSensitivity', label: 'Mouse sensitivity', min: 0.1, max: 5, step: 0.1 },
  { kind: 'bool', key: 'invertY', label: 'Invert camera Y' },
  { kind: 'bool', key: 'gamepad', label: 'Gamepad support' },
];

/** The sound form; the music list comes from the project's sounds. */
function soundFields(store: Store): Field[] {
  const music = store.project.sounds.filter((s) => s.kind !== 'sfx').map((s) => ({ value: s.id, label: s.name }));
  return [
    { kind: 'section', label: 'Sound' },
    { kind: 'select', key: 'music', label: 'Music', nullable: true, noneLabel: 'None', options: music, hint: 'A loop that plays while the game runs. Make one in the Audio tab.' },
    { kind: 'number', key: 'volume', label: 'Volume', min: 0, max: 1, step: 0.1, hint: 'Master volume of the whole game' },
  ];
}

const MENU_FIELDS: Field[] = [
  { kind: 'section', label: 'Look' },
  { kind: 'number', key: 'logoSize', label: 'Logo size', min: MIN_LOGO_SIZE, max: MAX_LOGO_SIZE, step: 5, unit: '%', hint: 'How much of the width of the screen the logo may take' },
  {
    kind: 'select',
    key: 'background',
    label: 'Background',
    options: [
      { value: 'dim', label: 'The game, dimmed' },
      { value: 'color', label: 'One color' },
      { value: 'picture', label: 'A picture' },
    ],
    hint: 'What is behind the menu when the game starts. A paused game always shows the menu over the dimmed game.',
  },
  { kind: 'color', key: 'backgroundColor', label: 'Color', hint: 'The color behind the menu (also around a picture that does not fill the screen)' },
  { kind: 'color', key: 'accent', label: 'Buttons', hint: 'The color of the buttons of the menu and of the settings screen' },
  { kind: 'section', label: 'Buttons' },
  { kind: 'text', key: 'startLabel', label: 'First button', hint: `What the button that starts the game says (up to ${MAX_LABEL_CHARS} letters). While paused it says Continue.` },
  { kind: 'text', key: 'settingsLabel', label: 'Second button', hint: 'What the button that opens the settings of the player says' },
];

/**
 * Read a picture file as a data URL that fits a limit of size (brought down when it is big, as a PNG, or as a JPEG
 * when even that is too heavy). A pixel picture stays crisp when it is made smaller by little.
 */
async function readPicture(file: File, maxWidth: number, maxHeight: number, maxChars: number): Promise<string> {
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
  const fit = fitWithin(img.naturalWidth, img.naturalHeight, maxWidth, maxHeight);
  const small = fit.width === img.naturalWidth && fit.height === img.naturalHeight;
  if (small && isImageDataUrl(original, maxChars)) return original;
  const canvas = document.createElement('canvas');
  canvas.width = fit.width;
  canvas.height = fit.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('could not resize the picture');
  ctx.imageSmoothingEnabled = fit.width * 2 > img.naturalWidth;
  ctx.drawImage(img, 0, 0, fit.width, fit.height);
  const png = canvas.toDataURL('image/png');
  const out = png.length > maxChars * 0.8 ? canvas.toDataURL('image/jpeg', 0.88) : png;
  if (!isImageDataUrl(out, maxChars)) throw new Error('the picture is too big: use a smaller one');
  return out;
}

type TabId = 'general' | 'variables' | 'menu' | 'splash' | 'controls' | 'sound';
const TABS: [TabId, string][] = [
  ['general', 'General'],
  ['variables', 'Variables'],
  ['menu', 'Menu'],
  ['splash', 'Splash'],
  ['controls', 'Controls'],
  ['sound', 'Sound'],
];
/** The tab that was open last, so the dialog comes back where it was left. */
let lastTab: TabId = 'general';

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
        const image = await readPicture(f, SPLASH_MAX_WIDTH, SPLASH_MAX_HEIGHT, MAX_SPLASH_CHARS);
        settings.splash = {
          image,
          seconds: settings.splash?.seconds ?? DEFAULT_SPLASH_SECONDS,
          background: settings.splash?.background ?? '#000000',
        };
        store.settingsChanged();
        renderSplash();
      } catch (err) {
        await appAlert(`Could not use this picture: ${err instanceof Error ? err.message : err}`, { title: 'Picture not used' });
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

  // ---- menu screen: a logo and the buttons under it
  const menuDraft: MenuScreen = resolveMenu(settings.menu);
  const menuBox = el('div', { class: 'menu-settings' });
  const stage = el('div', { class: 'menu-stage' });
  const stageFrame = el('div', { class: 'menu-preview' }, stage);
  const fitStage = () => {
    const w = stageFrame.clientWidth;
    if (w > 0) stage.style.transform = `scale(${w / 1280})`;
  };
  new ResizeObserver(fitStage).observe(stageFrame);
  /** The preview shows what the player will see first (1280 x 720, made smaller to fit). */
  const renderMenuPreview = () => {
    stage.replaceChildren();
    const layer = el('div', { class: 'menu-layer' });
    Object.assign(layer.style, menuBackdrop(menuDraft, false), { display: 'flex', alignItems: 'center', justifyContent: 'center', textAlign: 'center', color: '#fff' });
    layer.append(
      menuContent({
        menu: menuDraft,
        title: settings.name,
        paused: false,
        onStart: () => undefined,
        onSettings: () => undefined,
        onFullscreen: () => undefined,
      }),
    );
    stage.append(layer);
    fitStage();
  };
  const commitMenu = () => {
    const clean = normalizeMenu(menuDraft);
    if (clean) settings.menu = clean;
    else delete settings.menu;
    store.settingsChanged();
    renderMenuPreview();
  };
  /** A picture picker: a button that opens the file dialog and a button that takes the picture away. */
  const pictureRow = (label: string, has: () => boolean, limits: { w: number; h: number; chars: number }, set: (url: string | undefined) => void, note: string) => {
    const file = el('input', { type: 'file', accept: 'image/png,image/jpeg,image/gif,image/webp' });
    file.style.display = 'none';
    const status = el('span', { class: 'muted', text: has() ? 'Set' : 'None' });
    const choose = el('button', { class: 'btn', text: has() ? 'Change…' : 'Choose…', onclick: () => file.click() });
    const remove = el('button', {
      class: 'btn danger',
      text: 'Remove',
      onclick: () => {
        set(undefined);
        commitMenu();
        renderMenuControls();
      },
    });
    remove.disabled = !has();
    file.addEventListener('change', async () => {
      const f = file.files?.[0];
      file.value = '';
      if (!f) return;
      try {
        set(await readPicture(f, limits.w, limits.h, limits.chars));
        commitMenu();
        renderMenuControls();
      } catch (err) {
        await appAlert(`Could not use this picture: ${err instanceof Error ? err.message : err}`, { title: 'Picture not used' });
      }
    });
    return el(
      'div',
      { class: 'picture-row', title: note },
      el('span', { class: 'form-label', text: label }),
      el('span', { class: 'picture-row-controls' }, status, choose, remove, file),
    );
  };
  const menuControls = el('div', { class: 'menu-controls' });
  const renderMenuControls = () => {
    menuControls.replaceChildren();
    menuControls.append(
      pictureRow(
        'Logo',
        () => !!menuDraft.logo,
        { w: LOGO_MAX_WIDTH, h: LOGO_MAX_HEIGHT, chars: MAX_LOGO_CHARS },
        (url) => {
          if (url) menuDraft.logo = url;
          else delete menuDraft.logo;
        },
        'A picture with the name of your game, shown over the buttons. Up to 1024 × 512. Without one, the title of the game is written out.',
      ),
      buildForm(MENU_FIELDS.slice(0, 3), menuDraft as unknown as Record<string, unknown>, (key) => {
        commitMenu();
        if (key === 'background') renderMenuControls();
      }),
    );
    if (menuDraft.background === 'picture') {
      menuControls.append(
        pictureRow(
          'Picture',
          () => !!menuDraft.backgroundImage,
          { w: SPLASH_MAX_WIDTH, h: SPLASH_MAX_HEIGHT, chars: MAX_SPLASH_CHARS },
          (url) => {
            if (url) menuDraft.backgroundImage = url;
            else {
              delete menuDraft.backgroundImage;
              menuDraft.background = 'dim';
            }
          },
          'Fills the screen behind the menu. Up to 1280 × 720.',
        ),
      );
    }
    menuControls.append(
      buildForm(MENU_FIELDS.slice(3), menuDraft as unknown as Record<string, unknown>, () => commitMenu()),
      el('div', { class: 'button-stack row' }, el('button', {
        class: 'btn',
        text: 'Reset the menu',
        title: 'Back to the plain menu: the title, Start game and Settings',
        onclick: () => {
          Object.assign(menuDraft, DEFAULT_MENU);
          delete menuDraft.logo;
          delete menuDraft.backgroundImage;
          commitMenu();
          renderMenuControls();
        },
      })),
    );
  };
  menuBox.append(
    el('div', { class: 'muted menu-note', text: 'The first screen of the exported game: your logo, and under it Start game and Settings. The player’s own settings (volume, mouse, keys) open from the Settings button.' }),
    stageFrame,
    menuControls,
  );
  renderMenuControls();
  renderMenuPreview();

  // ---- the tabs
  const generalPanel = el(
    'div',
    { class: 'settings-panel' },
    buildForm(GAME_FIELDS, settings as unknown as Record<string, unknown>, () => store.settingsChanged()),
    buildForm(graphicsFields, graphics as unknown as Record<string, unknown>, () => {
      const n = parseFloat(graphics.renderScale);
      settings.renderScale = RENDER_SCALES.includes(n) ? n : 1;
      store.settingsChanged();
    }),
  );
  const splashPanel = el('div', { class: 'settings-panel' }, el('div', { class: 'form-section', text: 'Splash screen' }), splashBox);
  // what the buttons of a gamepad do (the same for every game; a Sony DualShock / DualSense or an Xbox pad)
  const padTable = el('div', { class: 'controls-table pad-table' });
  for (const h of GAMEPAD_HELP) padTable.append(el('div', { class: 'controls-row' }, el('span', { text: h.action }), el('span', { class: 'pad-buttons', text: h.buttons })));
  const controlsPanel = el(
    'div',
    { class: 'settings-panel' },
    buildForm(INPUT_FIELDS, settings as unknown as Record<string, unknown>, () => store.settingsChanged()),
    el('div', { class: 'form-section', text: 'Keys' }),
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
    el('div', { class: 'form-section', text: 'Gamepad' }),
    padTable,
    el('div', {
      class: 'muted menu-note',
      text: `${GAMEPAD_NAMES_NOTE} Plug a controller in (or pair it by Bluetooth) and press a button; Play and the exported game use it, and the menu is moved with the D-pad. Turn it off with “Gamepad support” above.`,
    }),
  );
  const soundPanel = el(
    'div',
    { class: 'settings-panel' },
    buildForm(soundFields(store), settings as unknown as Record<string, unknown>, () => store.settingsChanged()),
  );
  // the numbers of the game (coins, keys, health ...): they live in the project settings, not in the side bar
  const variablesPanel = el('div', { class: 'settings-panel' });
  const renderVariables = () => {
    variablesPanel.replaceChildren(
      buildVariablesPanel({
        variables: () => store.project.variables,
        add: () => {
          store.addVariable();
          renderVariables();
        },
        remove: (id) => {
          store.removeVariable(id);
          renderVariables();
        },
        rename: (id, name) => store.renameVariable(id, name),
        // a value changed: the fields stay as they are (drawing them again would take the focus)
        changed: () => store.variablesChanged(),
      }),
    );
  };
  renderVariables();
  const panels: Record<TabId, HTMLElement> = {
    general: generalPanel,
    variables: variablesPanel,
    menu: menuBox,
    splash: splashPanel,
    controls: controlsPanel,
    sound: soundPanel,
  };
  const tabBar = el('div', { class: 'tabs modal-tabs' });
  const tabButtons = new Map<TabId, HTMLElement>();
  const showTab = (id: TabId) => {
    lastTab = id;
    for (const [tabId, panel] of Object.entries(panels) as [TabId, HTMLElement][]) panel.classList.toggle('hidden', tabId !== id);
    for (const [tabId, b] of tabButtons) b.classList.toggle('active', tabId === id);
    if (id === 'menu') fitStage();
  };
  for (const [id, label] of TABS) {
    const b = el('button', { class: 'tab', text: label, onclick: () => showTab(id) });
    tabButtons.set(id, b);
    tabBar.append(b);
  }

  dialog.append(
    el('div', { class: 'modal-title' }, el('span', { text: 'Project Settings' }), el('button', { class: 'icon-btn', text: '✕', onclick: close })),
    tabBar,
    generalPanel,
    variablesPanel,
    menuBox,
    splashPanel,
    controlsPanel,
    soundPanel,
  );
  document.body.append(backdrop);
  showTab(lastTab);
}
