// The right-hand panel when the level itself, the paint tool or the sculpt tool is in front.

import { MAX_TERRAIN_CELLS, type SculptMode, flattenTerrain, generateHills, isTerrainGrid, resizeTerrain, terrainFrame, terrainRange } from '../../core/terrain';
import { SKY_PRESETS, SKY_STYLES } from '../../core/look';
import type { LevelBlock } from '../../core/types';
import { el } from '../ui/dom';
import { type Field, buildForm } from '../ui/form';
import { buildTilePicker } from '../ui/tilePicker';
import type { PanelHost } from './host';

/** Nothing is selected: the look of the level (sky, fog, sun, ambient light, shadows). */
export function buildLevelPanel(host: PanelHost): HTMLElement {
  const { store } = host;
  const level = store.level;
  const look = level.look;
  const root = el('div', { class: 'level-panel' });
  root.append(el('div', { class: 'section-title', text: `Level · ${level.name}` }));

  // a time of day to start from: sky, fog and light together
  const presets = el('div', { class: 'button-stack row wrap' });
  for (const p of SKY_PRESETS) {
    presets.append(
      el('button', {
        class: 'btn small',
        text: p.label,
        title: `${p.label}: the sky, the fog and the light of that time of day (change anything after)`,
        onclick: () => {
          store.applySkyPreset(p);
          host.refreshInspector();
        },
      }),
    );
  }

  // the sky color belongs to the level and the fog may follow it, so the form edits a view of them
  const view = {
    skyStyle: look.skyStyle as string,
    skyColor: level.sky,
    skyTop: look.skyTop,
    skyTexture: look.skyTexture as string | null,
    ownFog: look.fogColor !== null,
    fogColor: look.fogColor ?? level.sky,
  };
  const skyFields: Field[] = [
    {
      kind: 'select',
      key: 'skyStyle',
      label: 'Style',
      options: SKY_STYLES.map((s) => ({ value: s.value, label: s.label })),
      hint: 'What is behind the world: a flat color, a gradient, clouds, stars, or a picture of your own',
    },
    {
      kind: 'color',
      key: 'skyColor',
      label: look.skyStyle === 'color' ? 'Color' : 'Horizon color',
      hint: 'The color of the sky. With a gradient it is the color near the horizon. The fog fades into it unless it has its own color.',
    },
  ];
  if (look.skyStyle === 'gradient' || look.skyStyle === 'clouds' || look.skyStyle === 'stars') {
    skyFields.push({ kind: 'color', key: 'skyTop', label: 'Top color', hint: 'The color straight up' });
  }
  if (look.skyStyle === 'texture') {
    skyFields.push({
      kind: 'select',
      key: 'skyTexture',
      label: 'Picture',
      nullable: true,
      noneLabel: 'Pick a texture…',
      options: host.textures.names().map((t) => ({ value: t, label: t })),
      hint: 'A wide picture (2:1 works best) that wraps around the world: its middle row is the horizon. Import or paint one in the Paint tab.',
    });
  }
  const fogFields: Field[] = [
    { kind: 'bool', key: 'ownFog', label: 'Own color', hint: 'Off: the fog takes the color of the sky at the horizon, so far things melt into it. On: pick any color (a green swamp, a red haze).' },
  ];
  if (view.ownFog) fogFields.push({ kind: 'color', key: 'fogColor', label: 'Fog color' });

  const onView = (key: string) => {
    switch (key) {
      case 'skyStyle':
        look.skyStyle = view.skyStyle as typeof look.skyStyle;
        store.lookChanged();
        host.refreshInspector();
        break;
      case 'skyColor':
        store.setSky(view.skyColor);
        break;
      case 'skyTop':
        look.skyTop = view.skyTop;
        store.lookChanged();
        break;
      case 'skyTexture':
        look.skyTexture = view.skyTexture;
        store.lookChanged();
        break;
      case 'ownFog':
        look.fogColor = view.ownFog ? view.fogColor : null;
        store.lookChanged();
        host.refreshInspector();
        break;
      case 'fogColor':
        look.fogColor = view.fogColor;
        store.lookChanged();
        break;
    }
  };
  const viewTarget = view as unknown as Record<string, unknown>;

  root.append(
    el('div', { class: 'form-section', text: 'Time of day' }),
    presets,
    el('div', { class: 'form-section', text: 'Sky' }),
    buildForm(skyFields, viewTarget, onView),
    el('div', { class: 'form-section', text: 'Fog' }),
    buildForm(fogFields, viewTarget, onView),
    buildForm(
      [
        { kind: 'number', key: 'fogSky', label: 'Over the sky', min: 0, max: 1, step: 0.05, hint: 'How much the fog covers the sky as well: 0 leaves the sky clear, 0.3 a haze that is thick at the horizon, 1 hides the whole sky in fog. It grows with thick fog (a short "Ends at") and is gone without fog.' },
        { kind: 'number', key: 'fogNear', label: 'Starts at', min: 0, max: 500, step: 5, unit: 'm', hint: 'Distance where things begin to fade into the fog color' },
        { kind: 'number', key: 'fogFar', label: 'Ends at', min: 5, max: 1000, step: 10, unit: 'm', hint: 'Distance where they are gone' },
        { kind: 'section', label: 'Sun and light' },
        { kind: 'number', key: 'sunYaw', label: 'Sun direction', min: -360, max: 360, step: 15, unit: '°', hint: 'The compass direction the light comes from' },
        { kind: 'number', key: 'sunPitch', label: 'Sun height', min: 5, max: 90, step: 5, unit: '°', hint: 'Low = long evening shadows, 90 = straight above' },
        { kind: 'color', key: 'sunColor', label: 'Sun color' },
        { kind: 'number', key: 'sunIntensity', label: 'Sun strength', min: 0, max: 6, step: 0.1 },
        { kind: 'number', key: 'ambient', label: 'Ambient', min: 0, max: 6, step: 0.1, hint: 'The soft light from all around; high = flat and bright, low = moody' },
        { kind: 'bool', key: 'shadows', label: 'Shadows', hint: 'Real shadows from the sun. Off: a round blob under the player' },
      ],
      look as unknown as Record<string, unknown>,
      () => store.lookChanged(),
    ),
  );
  return root;
}

/** The terrain the sculpt panel works on: the selected one, else the only one in the level. */
function terrainTarget(host: PanelHost): LevelBlock | null {
  const sel = host.store.selectedObject();
  if (sel && sel.kind === 'block' && sel.terrain) return sel;
  const all = host.store.objects.filter((o): o is LevelBlock => o.kind === 'block' && !!o.terrain);
  return all.length === 1 ? all[0]! : null;
}

/** The sculpt tool: the brush, and what can be done to a whole terrain. */
export function buildSculptPanel(host: PanelHost): HTMLElement {
  const vp = host.viewport;
  const root = el('div', { class: 'sculpt-panel' });
  root.append(
    el('div', { class: 'section-title', text: 'Sculpt terrain' }),
    el('div', {
      class: 'empty muted',
      text: 'Hold the left mouse over a terrain: the ring shows the brush. Holding still keeps working. Add a terrain with + Add shape… > Terrain.',
    }),
  );

  const modes: { id: SculptMode | 'paint'; label: string; hint: string }[] = [
    { id: 'raise', label: 'Raise', hint: 'Pull the ground up' },
    { id: 'lower', label: 'Lower', hint: 'Push the ground down' },
    { id: 'smooth', label: 'Smooth', hint: 'Even out bumps' },
    { id: 'flatten', label: 'Flatten', hint: 'Pull toward the height where the stroke began' },
    { id: 'paint', label: 'Paint', hint: 'Paint the tile below on the cells inside the ring' },
  ];
  const buttons = el('div', { class: 'button-stack wrap' });
  for (const m of modes) {
    buttons.append(
      el('button', {
        class: `btn${vp.sculptMode === m.id ? ' primary' : ''}`,
        text: m.label,
        title: m.hint,
        onclick: () => {
          vp.sculptMode = m.id;
          host.refreshInspector();
        },
      }),
    );
  }
  root.append(
    buttons,
    buildForm(
      [
        { kind: 'number', key: 'sculptRadius', label: 'Radius', min: 0.5, max: 16, step: 0.5, unit: 'm' },
        { kind: 'number', key: 'sculptStrength', label: 'Strength', min: 0.05, max: 1, step: 0.05, hint: 'How much one touch of the brush changes' },
      ],
      vp as unknown as Record<string, unknown>,
      () => undefined,
    ),
  );

  if (vp.sculptMode === 'paint') {
    if (!vp.brush) {
      const atlas = host.textures.atlasWithTile(7, 0) ?? host.textures.names()[0];
      if (atlas) vp.brush = { texture: atlas, col: 7, row: 0 };
    }
    const brush = vp.brush;
    if (brush) {
      root.append(
        el(
          'div',
          { class: 'button-stack row' },
          el('button', { class: `btn${vp.brushMode === 'paint' ? ' primary' : ''}`, text: 'Lay tile', onclick: () => { vp.brushMode = 'paint'; host.refreshInspector(); } }),
          el('button', { class: `btn${vp.brushMode === 'erase' ? ' primary' : ''}`, text: 'Erase tile', onclick: () => { vp.brushMode = 'erase'; host.refreshInspector(); } }),
        ),
        buildTilePicker({
          textures: host.textures,
          get: () => ({ texture: brush.texture, col: brush.col, row: brush.row }),
          onPick: (t) => {
            vp.brush = { ...t, ...(brush.rot ? { rot: brush.rot } : {}), ...(brush.flip ? { flip: true } : {}) };
            vp.brushMode = 'paint';
            host.refreshInspector();
          },
          zoom: 2,
          maxHeight: 260,
        }).el,
      );
    }
  }

  // what can be done to the whole terrain
  const terrain = terrainTarget(host);
  root.append(el('div', { class: 'form-section', text: 'This terrain' }));
  if (!terrain || !terrain.terrain) {
    root.append(el('div', { class: 'empty muted', text: 'Select a terrain (or add one) to generate or flatten it.' }));
    return root;
  }
  const info = terrain.terrain;
  if (!isTerrainGrid(terrain.mesh, info)) {
    root.append(el('div', { class: 'empty muted', text: 'This terrain was edited with the mesh tools, so it can no longer be sculpted or generated.' }));
    return root;
  }
  const range = terrainRange(terrain.mesh);
  const frame = terrainFrame(terrain.mesh, info);
  const cellNow = Math.round(Math.abs(frame.dx) * 100) / 100;
  const widthNow = Math.round(info.cols * Math.abs(frame.dx) * 10) / 10;
  const depthNow = Math.round(info.rows * Math.abs(frame.dz) * 10) / 10;
  root.append(
    el('div', {
      class: 'empty muted',
      text: `${info.cols} × ${info.rows} cells of ${cellNow} m, ${widthNow} × ${depthNow} m. Heights from ${range.min.toFixed(1)} to ${range.max.toFixed(1)} m.`,
    }),
  );

  // growing or shrinking: what was sculpted and painted stays (resizing with the Size field only stretches it)
  const size = { width: widthNow, depth: depthNow, cell: cellNow };
  const plan = () => {
    const cell = Math.max(0.25, size.cell);
    const cols = Math.max(1, Math.round(size.width / cell));
    const rows = Math.max(1, Math.round(size.depth / cell));
    return { cell, cols: Math.min(MAX_TERRAIN_CELLS, cols), rows: Math.min(MAX_TERRAIN_CELLS, rows), clamped: cols > MAX_TERRAIN_CELLS || rows > MAX_TERRAIN_CELLS };
  };
  const planText = el('div', { class: 'empty muted' });
  const showPlan = () => {
    const p = plan();
    planText.textContent = `Becomes ${p.cols} × ${p.rows} cells, ${(p.cols * p.cell).toFixed(1)} × ${(p.rows * p.cell).toFixed(1)} m${p.clamped ? ` (${MAX_TERRAIN_CELLS} cells is the most one side can have: use bigger cells for more room)` : ''}.`;
  };
  showPlan();
  root.append(
    el('div', { class: 'form-section', text: 'Size' }),
    buildForm(
      [
        { kind: 'number', key: 'width', label: 'Width', min: 2, max: 2048, step: 8, unit: 'm', hint: 'East–west size. Bigger adds new flat ground around what you sculpted; smaller cuts it off.' },
        { kind: 'number', key: 'depth', label: 'Depth', min: 2, max: 2048, step: 8, unit: 'm', hint: 'North–south size' },
        { kind: 'number', key: 'cell', label: 'Cell size', min: 0.25, max: 16, step: 0.25, unit: 'm', hint: 'Smaller cells: finer sculpting and painting, but fewer meters fit in one terrain' },
      ],
      size as unknown as Record<string, unknown>,
      showPlan,
    ),
    planText,
    el(
      'div',
      { class: 'button-stack row' },
      el('button', {
        class: 'btn',
        text: 'Resize terrain',
        title: 'Keeps your heights and painted tiles in place (undo brings the old size back)',
        onclick: () => {
          const p = plan();
          const out = resizeTerrain(terrain.mesh, info, { cols: p.cols, rows: p.rows, cell: p.cell });
          terrain.mesh = out.mesh;
          terrain.terrain = out.info;
          host.store.objectChanged(terrain.id);
          host.refreshInspector();
        },
      }),
      el('button', {
        class: 'btn',
        text: 'Double',
        title: 'Twice as wide and deep, same cells',
        onclick: () => {
          const out = resizeTerrain(terrain.mesh, info, { cols: info.cols * 2, rows: info.rows * 2, cell: cellNow });
          terrain.mesh = out.mesh;
          terrain.terrain = out.info;
          host.store.objectChanged(terrain.id);
          host.refreshInspector();
        },
      }),
    ),
    el('div', { class: 'form-section', text: 'Hills' }),
  );
  const hills = { seed: 1, height: 4, scale: 10 };
  root.append(
    buildForm(
      [
        { kind: 'number', key: 'seed', label: 'Seed', min: 1, max: 9999, step: 1 },
        { kind: 'number', key: 'height', label: 'Height', min: 0.5, max: 30, step: 0.5, unit: 'm' },
        { kind: 'number', key: 'scale', label: 'Width', min: 2, max: 60, step: 1, unit: 'm', hint: 'How broad the hills are' },
      ],
      hills as unknown as Record<string, unknown>,
      () => undefined,
    ),
    el(
      'div',
      { class: 'button-stack row' },
      el('button', {
        class: 'btn',
        text: 'Generate hills',
        title: 'Replace the heights with rolling hills (undo brings the old ones back)',
        onclick: () => {
          generateHills(terrain.mesh, hills);
          host.store.objectChanged(terrain.id);
          host.refreshInspector();
        },
      }),
      el('button', {
        class: 'btn',
        text: 'Flatten all',
        onclick: () => {
          flattenTerrain(terrain.mesh, 0);
          host.store.objectChanged(terrain.id);
          host.refreshInspector();
        },
      }),
    ),
  );
  return root;
}

/** The paint tool: which tile goes onto the faces you click. */
export function buildPaintPanel(host: PanelHost): HTMLElement {
  const vp = host.viewport;
  if (!vp.brush) {
    const atlas = host.textures.atlasWithTile(7, 0) ?? host.textures.names()[0];
    if (atlas) vp.brush = { texture: atlas, col: 7, row: 0 };
  }
  const root = el('div', { class: 'paint-panel' });
  root.append(
    el('div', { class: 'section-title', text: 'Paint tiles' }),
    el('div', {
      class: 'empty muted',
      text: 'Click or drag over faces to paint them with the tile. Shift paints the whole block, Ctrl / Cmd picks the tile under the cursor. Faces you did not paint keep the block’s own tile.',
    }),
  );

  const mode = (id: 'paint' | 'erase', label: string, title: string) =>
    el('button', {
      class: `btn${vp.brushMode === id ? ' primary' : ''}`,
      text: label,
      title,
      onclick: () => {
        vp.brushMode = id;
        host.refreshInspector();
      },
    });
  root.append(
    el(
      'div',
      { class: 'button-stack row' },
      mode('paint', 'Paint', 'Lay the tile down on the faces you click'),
      mode('erase', 'Erase', 'Take the painted tile off a face (it shows the block’s own tile again)'),
    ),
  );

  if (vp.brushMode === 'paint' && vp.brush) {
    const brush = vp.brush;
    const picker = buildTilePicker({
      textures: host.textures,
      get: () => ({ texture: brush.texture, col: brush.col, row: brush.row }),
      onPick: (t) => {
        vp.brush = { ...t, ...(brush.rot ? { rot: brush.rot } : {}), ...(brush.flip ? { flip: true } : {}) };
        host.refreshInspector();
      },
      zoom: 2,
      maxHeight: 320,
    });
    root.append(
      picker.el,
      el(
        'div',
        { class: 'button-stack row' },
        el('button', {
          class: 'btn',
          text: `Turn ${((brush.rot ?? 0) * 90) % 360}°`,
          title: 'Turn the picture a quarter turn on the face',
          onclick: () => {
            vp.brush = { ...brush, rot: ((brush.rot ?? 0) + 1) % 4 };
            host.refreshInspector();
          },
        }),
        el('button', {
          class: `btn${brush.flip ? ' primary' : ''}`,
          text: 'Mirror',
          title: 'Flip the picture left to right',
          onclick: () => {
            vp.brush = { ...brush, flip: !brush.flip };
            host.refreshInspector();
          },
        }),
      ),
    );
  }
  return root;
}
