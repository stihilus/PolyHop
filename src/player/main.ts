// The exported game: loads the project embedded in the page and runs it. Built as one plain script
// (see vite.player.config.ts) so an export works from any folder, from itch.io, and even from file://.

import * as THREE from 'three';
import { ACTION_LABELS, keyLabel } from '../core/keys';
import { ACTIONS, type Action, normalizeProject } from '../core/types';
import { createEnvironment } from '../runtime/environment';
import { Game } from '../runtime/game';
import {
  type Controls,
  type PlayerPrefs,
  browserStorage,
  controlsDiff,
  loadPrefs,
  prefsKey,
  rebindKey,
  resolveSettings,
  savePrefs,
} from '../runtime/prefs';
import { TextureLibrary } from '../runtime/textures';
import { showSplash } from '../runtime/splash';
import { TouchControls, wantsTouchControls } from '../runtime/touch';
import { button, div } from './dom';
import { createSettingsMenu } from './settingsMenu';

interface PlayerOptions {
  /** Shows the controls on the start screen. */
  showControls: boolean;
  background: string;
}

function readJson<T>(id: string): T | null {
  const node = document.getElementById(id);
  if (!node?.textContent) return null;
  try {
    return JSON.parse(node.textContent) as T;
  } catch {
    return null;
  }
}

async function main(): Promise<void> {
  const root = document.getElementById('game');
  const rawProject = readJson<unknown>('polyhop-project');
  const options = readJson<PlayerOptions>('polyhop-options') ?? { showControls: true, background: '#14161b' };
  if (!root || !rawProject) {
    document.body.textContent = 'This game has no project data.';
    return;
  }
  const project = normalizeProject(rawProject);
  document.title = project.settings.name;

  // the splash screen comes first, before the game is built (which takes a moment in a big level)
  if (project.settings.splash) {
    showSplash(root, project.settings.splash, () => undefined);
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  }

  // what the player changed for themselves (kept in the browser) goes over what the author set
  const storage = browserStorage();
  const storeKey = prefsKey(project.settings.name);
  const authored = structuredClone(project.settings);
  let prefs: PlayerPrefs = loadPrefs(storage, storeKey);
  Object.assign(project.settings, resolveSettings(authored, prefs));

  const textures = new TextureLibrary();
  textures.bind(() => project.textures);

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  // a lower render scale draws the game coarser and lets the browser blow it up with hard pixel edges
  const applyRenderScale = () => {
    const scale = project.settings.renderScale;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2) * scale);
    renderer.domElement.style.imageRendering = scale < 1 ? 'pixelated' : '';
  };
  applyRenderScale();
  root.append(renderer.domElement);
  const scene = new THREE.Scene();
  const environment = createEnvironment(scene, renderer);
  const camera = new THREE.PerspectiveCamera(60, 1, 0.05, 400);
  const game = new Game(scene, camera, renderer.domElement, textures, project);
  if (prefs.muted) game.audio.setMuted(true);
  const applyLook = (level: (typeof project.levels)[number]) => {
    environment.setLevel(level, textures);
  };
  game.onLevelShown = applyLook;
  applyLook(project.levels[0]!);
  const followPoint = new THREE.Vector3();

  const resize = () => {
    const w = Math.max(1, root.clientWidth);
    const h = Math.max(1, root.clientHeight);
    renderer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };
  new ResizeObserver(resize).observe(root);
  resize();

  // ---- start / pause screen
  const overlay = div({
    position: 'absolute',
    inset: '0',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'rgba(20, 22, 27, 0.86)',
    color: '#fff',
    textAlign: 'center',
    zIndex: '30',
  });
  root.append(overlay);

  // ---- settings of the player
  const commit = () => {
    Object.assign(project.settings, resolveSettings(authored, prefs));
    game.audio.setVolume(project.settings.volume);
    savePrefs(storage, storeKey, prefs);
  };
  let overlayPaused = false;
  const settingsMenu = createSettingsMenu({
    touch: () => game.touchMode,
    values: () => {
      const s = project.settings;
      return {
        volume: s.volume,
        muted: game.audio.muted,
        mouseSensitivity: s.mouseSensitivity,
        invertY: s.invertY,
        renderScale: s.renderScale,
        controls: s.controls as Controls,
      };
    },
    change: (patch) => {
      prefs = { ...prefs, ...patch };
      if (patch.muted !== undefined) game.audio.setMuted(patch.muted);
      commit();
      if (patch.renderScale !== undefined) {
        applyRenderScale();
        resize();
      }
    },
    rebind: (action: Action, code: string) => {
      const diff = controlsDiff(authored.controls as Controls, rebindKey(project.settings.controls as Controls, action, code));
      const { controls: _old, ...rest } = prefs;
      prefs = Object.keys(diff).length > 0 ? { ...rest, controls: diff } : rest;
      commit();
    },
    reset: () => {
      prefs = {};
      game.audio.setMuted(false);
      commit();
      applyRenderScale();
      resize();
      settingsMenu.refresh();
    },
    back: () => showOverlay(overlayPaused),
  });
  const showSettings = () => {
    overlay.replaceChildren(settingsMenu.element);
    settingsMenu.refresh();
  };

  // ---- phone controls: from the start on a touch device, or when the first touch shows up
  let touch: TouchControls | null = null;
  const enableTouch = () => {
    if (touch) return;
    touch = new TouchControls(root, () => pause());
    game.setTouch(touch.state);
    if (started && !game.paused) touch.show();
  };

  let started = false;
  const showOverlay = (paused: boolean) => {
    overlayPaused = paused;
    touch?.hide();
    overlay.replaceChildren();
    overlay.style.display = 'flex';
    overlay.append(
      div({ fontSize: '40px', margin: '0 0 6px' }, project.settings.name),
      div({ fontSize: '16px', color: '#9aa3b2', margin: '0 0 18px' }, paused ? 'Paused' : 'Ready'),
    );
    if (options.showControls) {
      const table = div({ fontSize: '14px', color: '#cfd5e0', margin: '0 0 18px', lineHeight: '1.7' });
      if (game.touchMode) {
        table.append(div({}, 'Left side: move'), div({}, 'Right side: look around'), div({ color: '#9aa3b2' }, 'Buttons: Jump, Use, Run, Duck'));
      } else {
        for (const action of ACTIONS) {
          const keys = project.settings.controls[action].map(keyLabel).join(' / ');
          table.append(div({}, `${ACTION_LABELS[action]}: ${keys}`));
        }
        table.append(div({ color: '#9aa3b2' }, 'Mouse: turn / look · M: sound on / off'));
      }
      overlay.append(table);
    }
    overlay.append(
      button(paused ? 'Continue' : 'Play', start),
      div(
        { display: 'flex', flexWrap: 'wrap', justifyContent: 'center' },
        button('Settings', showSettings, true),
        button('Fullscreen', () => void (document.fullscreenElement ? document.exitFullscreen() : root.requestFullscreen?.()), true),
      ),
    );
  };

  const lockMouse = () => {
    try {
      void (renderer.domElement.requestPointerLock() as unknown as Promise<void> | undefined)?.catch?.(() => {});
    } catch {
      // pointer lock can be refused (embedded frames); dragging the mouse still looks around
    }
  };
  // "Play again" on the end screen is a click: take the mouse back
  game.onRestart = lockMouse;

  function start(): void {
    overlay.style.display = 'none';
    if (!started) {
      started = true;
      game.startPlay();
      if (project.settings.fullscreen) void root!.requestFullscreen?.().catch(() => {});
    }
    game.setPaused(false);
    lockMouse();
    touch?.show();
  }

  const pause = () => {
    // the end screen has its own buttons and gave the mouse back on purpose
    if (!started || game.paused || game.ended) return;
    game.setPaused(true);
    showOverlay(true);
  };
  document.addEventListener('pointerlockchange', () => {
    if (document.pointerLockElement !== renderer.domElement) pause();
  });
  window.addEventListener('keydown', (e) => {
    if (e.code === 'Escape') pause();
    else if (e.code === 'KeyM') {
      game.audio.setMuted(!game.audio.muted);
      prefs = { ...prefs, muted: game.audio.muted };
      commit();
    }
  });
  window.addEventListener('blur', pause);

  if (wantsTouchControls()) enableTouch();
  else window.addEventListener('touchstart', enableTouch, { once: true, passive: true });
  showOverlay(false);
  // make the music while the start screen is up
  window.setTimeout(() => game.prepareAudio(), 120);

  // ---- loop
  let last = performance.now();
  const frame = (now: number) => {
    requestAnimationFrame(frame);
    const dt = Math.min((now - last) / 1000, 0.1);
    last = now;
    game.update(dt);
    const c = game.controller.pos;
    environment.followSun(followPoint.set(c[0], c[1], c[2]));
    renderer.render(scene, camera);
  };
  requestAnimationFrame(frame);
}

void main();
