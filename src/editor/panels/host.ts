// What the panels of the editor need from the editor itself. The panels are plain functions that
// build the DOM of a part of the right-hand properties panel or the Assets list; the editor passes
// itself in as this host, so they do not depend on its internals.

import type { PresetKind } from '../../core/presets';
import type { LevelObject, Vec3 } from '../../core/types';
import type { TextureLibrary } from '../../runtime/textures';
import type { ModelEditor } from '../modelEditor';
import type { Store } from '../store';
import type { Viewport } from '../viewport';

export type Mode = 'level' | 'model' | 'paint' | 'animate' | 'audio';
export type LeftTab = 'scene' | 'assets' | 'vars';

export interface PanelHost {
  readonly store: Store;
  readonly viewport: Viewport;
  readonly textures: TextureLibrary;
  readonly modelEditor: ModelEditor;
  /** The properties panel the inspector builders fill. */
  readonly inspector: HTMLElement;
  readonly leftTab: LeftTab;
  /** The game object asset open in the properties panel, or null. */
  selectedPrefabId: string | null;
  readonly selectedAssetId: string | null;

  refreshInspector(): void;
  refreshAssets(): void;
  /** An object (or an asset's template) was edited. */
  touch(obj: LevelObject): void;
  /** The rule editor of an object. */
  behaviorEditor(obj: LevelObject, apply: (kind: PresetKind) => void): HTMLElement;
  applyPreset(obj: LevelObject, kind: PresetKind): void;
  setMode(mode: Mode): void;
  setLeftTab(tab: LeftTab): void;
  openAnimation(modelId: string | null): void;
  /** Select a model or a game object in the Assets panel. */
  selectAsset(sel: { model?: string; prefab?: string } | null): void;
  placePrefab(id: string, position: Vec3): void;
  placeModel(id: string, position: Vec3): void;
  newModel(): void;
  duplicateSelected(): void;
  deleteSelected(): void;
  /** The choices of "+ New object…" depend on the models. */
  fillNewObjectSelect(): void;
}
