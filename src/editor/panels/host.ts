// What the panels of the editor need from the editor itself. The panels are plain functions that
// build the DOM of a part of the right-hand properties panel or the Assets list; the editor passes
// itself in as this host, so they do not depend on its internals.

import type { PresetKind } from '../../core/presets';
import type { LevelObject, Model, Vec3 } from '../../core/types';
import type { TextureLibrary } from '../../runtime/textures';
import type { ModelEditor } from '../modelEditor';
import type { Store } from '../store';
import type { Viewport } from '../viewport';

export type Mode = 'level' | 'model' | 'paint' | 'animate' | 'audio';

export interface PanelHost {
  readonly store: Store;
  readonly viewport: Viewport;
  readonly textures: TextureLibrary;
  readonly modelEditor: ModelEditor;
  /** The properties panel the inspector builders fill. */
  readonly inspector: HTMLElement;
  /** The model (component or object) selected in the Assets, whose properties are shown, or null. */
  readonly selectedAssetId: string | null;

  refreshInspector(): void;
  refreshAssets(): void;
  /** An object was edited. */
  touch(obj: LevelObject): void;
  /** The rule editor of an object (an instance of a component follows the rules of the component until it sets its own). */
  behaviorEditor(obj: LevelObject, apply: (kind: PresetKind) => void): HTMLElement;
  /** The rule editor of what a component's placements do by default. */
  componentBehaviorEditor(model: Model): HTMLElement;
  applyPreset(obj: LevelObject, kind: PresetKind): void;
  setMode(mode: Mode): void;
  /** Open a model in the Models tab (a built-in one that the project lacks is added first). */
  openModel(modelId: string): void;
  openAnimation(modelId: string | null): void;
  /** Select a model in the Assets (null: none). */
  selectAsset(modelId: string | null): void;
  /** Select an object of the level. */
  selectObject(id: string): void;
  placeModel(id: string, position: Vec3): void;
  /** The object (a block or a model placement) becomes a component and stays where it is as its master. */
  makeComponent(objectId: string): void;
  setComponent(modelId: string, on: boolean): void;
  duplicateModel(modelId: string): void;
  newModel(): void;
  duplicateSelected(): void;
  deleteSelected(): void;
}
