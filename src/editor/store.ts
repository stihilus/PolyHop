import { normalizeVariables, renameVariableInRules } from '../core/logic';
import { type SkyPreset, normalizeLook } from '../core/look';
import {
  clearOverride,
  componentFromBlock,
  componentFromInstance,
  dependentsOf,
  instancesOf,
  isComponent,
  makeVariant,
  placeInstance,
  setOverride,
  syncInstances,
  builtInComponent,
  presetOfModel,
} from '../core/components';
import { scaleMeshToSize } from '../core/mesh';
import { renameBoneInModel } from '../core/rig';
import {
  DEFAULT_SKY,
  type LevelData,
  type InstanceOverride,
  type LevelModelInstance,
  type LevelObject,
  type Model,
  type PlayerSettings,
  type Project,
  type ProjectTexture,
  type Selection,
  cloneModel,
  createLevelData,
  emptyLevelObjects,
  newId,
  normalizeObject,
} from '../core/types';

export type StoreEvent =
  | { type: 'project-replaced' }
  | { type: 'selection' }
  /** `live` = emitted continuously while a gizmo drag is in progress (viewport already updated). */
  | { type: 'object-changed'; id: string; live?: boolean }
  | { type: 'level-restored' }
  /** Another level is being edited, or the list of levels changed (added, removed, renamed, reordered). */
  | { type: 'levels-changed' }
  /** The look or the default behavior of a component changed (its instances follow it). */
  | { type: 'components-changed'; id: string }
  /** The sky color of the level being edited changed. */
  | { type: 'sky-changed' }
  /** An undo step was recorded (the undo / redo buttons need a refresh). */
  | { type: 'history-changed' }
  | { type: 'object-added'; id: string }
  | { type: 'object-removed'; id: string }
  | { type: 'model-added'; id: string }
  | { type: 'model-removed'; id: string }
  /** `structural` = geometry/size changed (needs rebuild); otherwise only pixels changed. */
  | { type: 'model-changed'; id: string; structural: boolean }
  /** `structural` = a texture was added/removed/resized; otherwise only pixels changed (already live). */
  | { type: 'texture-changed'; name: string; structural: boolean }
  /** `live` = emitted while a gizmo drag moves the player spawn. */
  | { type: 'player-changed'; live?: boolean }
  | { type: 'variables-changed' }
  | { type: 'sounds-changed' }
  | { type: 'settings-changed' };

type Listener = (e: StoreEvent) => void;

/** Editor state: the project being edited plus the current selection. UI and viewport react to events. */
export class Store {
  /** The main selection (the active object, whose properties are shown). */
  selection: Selection = { kind: 'none' };
  /** More selected objects besides the active one (Shift-click or a drag rectangle in the view). */
  private extraSelected: string[] = [];
  /** The level being edited (an index into `project.levels`). */
  levelIndex = 0;
  private listeners = new Set<Listener>();

  // undo/redo for the level: JSON snapshots of the objects and the player settings
  private levelUndo: string[] = [];
  private levelRedo: string[] = [];
  private levelCurrent = '';
  private levelLabel = '';
  private levelAt = 0;

  constructor(public project: Project) {
    this.resetLevelHistory();
  }

  // ---------------------------------------------------------------- level history

  /** The level being edited. */
  get level(): LevelData {
    return this.project.levels[this.levelIndex]!;
  }

  /** The objects of the level being edited. */
  get objects(): LevelObject[] {
    return this.level.objects;
  }

  private snapshotLevel(): string {
    return JSON.stringify({
      levels: this.project.levels,
      levelIndex: this.levelIndex,
      player: this.project.player,
      variables: this.project.variables,
      // what makes a model a component (not its shapes: those have the history of the model editor)
      components: this.project.models.map((m) => ({
        id: m.id,
        name: m.name,
        component: m.component,
        mapping: m.mapping,
        look: m.look,
        defaults: m.defaults,
        // a block-like component is its one shape: resizing it in the level is an undo step of the level
        shapes: m.mapping === 'tile' && m.cubes.length <= 2 ? m.cubes : undefined,
      })),
    });
  }

  private resetLevelHistory(): void {
    this.levelUndo = [];
    this.levelRedo = [];
    this.levelCurrent = this.snapshotLevel();
    this.levelLabel = '';
  }

  /** Record the current level state as an undo step. Rapid `edit:` steps with one label merge. */
  commitLevel(label: string): void {
    const snap = this.snapshotLevel();
    if (snap === this.levelCurrent) return;
    const now = performance.now();
    const coalesce = label.startsWith('edit:') && label === this.levelLabel && now - this.levelAt < 700 && this.levelUndo.length > 0;
    if (!coalesce) {
      this.levelUndo.push(this.levelCurrent);
      if (this.levelUndo.length > 100) this.levelUndo.shift();
    }
    this.levelRedo = [];
    this.levelCurrent = snap;
    this.levelLabel = label;
    this.levelAt = now;
    this.emit({ type: 'history-changed' });
  }

  get canUndoLevel(): boolean {
    return this.levelUndo.length > 0;
  }
  get canRedoLevel(): boolean {
    return this.levelRedo.length > 0;
  }

  undoLevel(): void {
    const prev = this.levelUndo.pop();
    if (prev === undefined) return;
    this.levelRedo.push(this.levelCurrent);
    this.restoreLevel(prev);
  }

  redoLevel(): void {
    const next = this.levelRedo.pop();
    if (next === undefined) return;
    this.levelUndo.push(this.levelCurrent);
    this.restoreLevel(next);
  }

  private restoreLevel(snapshot: string): void {
    const data = JSON.parse(snapshot) as {
      levels: Partial<LevelData>[];
      levelIndex: number;
      player: PlayerSettings;
      variables?: unknown;
      components?: {
        id: string;
        name: string;
        component?: boolean;
        mapping?: 'tile';
        look?: Model['look'];
        defaults?: Model['defaults'];
        shapes?: Model['cubes'];
      }[];
    };
    this.project.levels = data.levels.map((l) => ({
      id: l.id ?? newId(),
      name: l.name ?? 'Level',
      objects: (l.objects ?? []).map((o) => normalizeObject(o as Partial<LevelObject>)),
      spawn: l.spawn ?? [0, 0.05, 0],
      spawnYaw: l.spawnYaw ?? 180,
      sky: l.sky ?? DEFAULT_SKY,
      look: normalizeLook(l.look),
    }));
    this.levelIndex = Math.min(Math.max(0, data.levelIndex), this.project.levels.length - 1);
    if (data.variables !== undefined) this.project.variables = normalizeVariables(data.variables, newId);
    const reshaped: string[] = [];
    for (const c of data.components ?? []) {
      const m = this.getModel(c.id);
      if (!m) continue;
      m.name = c.name;
      if (c.component) m.component = true;
      else delete m.component;
      if (c.mapping) m.mapping = c.mapping;
      else delete m.mapping;
      if (c.look) m.look = c.look;
      else delete m.look;
      if (c.defaults) m.defaults = c.defaults;
      else delete m.defaults;
      if (c.shapes && JSON.stringify(c.shapes) !== JSON.stringify(m.cubes)) {
        m.cubes = c.shapes;
        reshaped.push(m.id);
      }
    }
    for (const id of reshaped) this.emit({ type: 'model-changed', id, structural: true });
    Object.assign(this.project.player, data.player); // keep the object identity the game holds on to
    this.levelCurrent = snapshot;
    this.levelLabel = '';
    const sel = this.selection;
    this.extraSelected = this.extraSelected.filter((id) => this.getObject(id));
    if (sel.kind === 'object' && !this.getObject(sel.id)) {
      const next = this.extraSelected.shift();
      this.selection = next ? { kind: 'object', id: next } : { kind: 'none' };
    }
    this.emit({ type: 'level-restored' });
    this.emit({ type: 'levels-changed' });
    for (const c of data.components ?? []) this.emit({ type: 'components-changed', id: c.id });
    this.emit({ type: 'variables-changed' });
    this.emit({ type: 'selection' });
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  emit(e: StoreEvent): void {
    for (const fn of this.listeners) fn(e);
  }

  setProject(p: Project): void {
    this.project = p;
    this.levelIndex = 0;
    this.selection = { kind: 'none' };
    this.extraSelected = [];
    this.resetLevelHistory();
    this.emit({ type: 'project-replaced' });
  }

  select(sel: Selection): void {
    this.selection = sel;
    this.extraSelected = [];
    this.emit({ type: 'selection' });
  }

  /** Ids of every selected object, the active one first. */
  selectedIds(): string[] {
    if (this.selection.kind !== 'object') return [];
    return [this.selection.id, ...this.extraSelected];
  }

  isSelected(id: string): boolean {
    return this.selection.kind === 'object' && (this.selection.id === id || this.extraSelected.includes(id));
  }

  /** Add the object to the selection, or take it out when it is already part of it. */
  toggleObject(id: string): void {
    if (this.selection.kind !== 'object') {
      this.select({ kind: 'object', id });
      return;
    }
    const ids = this.selectedIds();
    if (ids.includes(id)) {
      const rest = ids.filter((x) => x !== id);
      if (rest.length === 0) {
        this.select({ kind: 'none' });
        return;
      }
      this.selection = { kind: 'object', id: rest[0]! };
      this.extraSelected = rest.slice(1);
    } else {
      // the one just clicked becomes the active object
      this.selection = { kind: 'object', id };
      this.extraSelected = ids;
    }
    this.emit({ type: 'selection' });
  }

  /** Select exactly these objects (the first is the active one). */
  selectObjects(ids: string[]): void {
    const unique = [...new Set(ids)].filter((id) => this.getObject(id));
    if (unique.length === 0) {
      this.select({ kind: 'none' });
      return;
    }
    this.selection = { kind: 'object', id: unique[0]! };
    this.extraSelected = unique.slice(1);
    this.emit({ type: 'selection' });
  }

  getObject(id: string): LevelObject | undefined {
    return this.objects.find((o) => o.id === id);
  }

  // ---------------------------------------------------------------- levels

  /** Edit another level. Not an undo step; the history keeps working across levels. */
  setLevel(index: number): void {
    const i = Math.min(Math.max(0, index), this.project.levels.length - 1);
    if (i === this.levelIndex) return;
    this.levelIndex = i;
    this.selection = { kind: 'none' };
    this.extraSelected = [];
    this.levelCurrent = this.snapshotLevel();
    this.levelLabel = '';
    this.emit({ type: 'levels-changed' });
    this.emit({ type: 'selection' });
  }

  /** A new level after the current one (a flat ground, the player at the origin), which is then edited. */
  addLevel(name?: string): void {
    const level = createLevelData(name?.trim() || `Level ${this.project.levels.length + 1}`, emptyLevelObjects());
    this.project.levels.splice(this.levelIndex + 1, 0, level);
    this.commitLevel('add-level');
    this.setLevel(this.levelIndex + 1);
  }

  duplicateLevel(): void {
    const src = this.level;
    const copy: LevelData = structuredClone(src);
    copy.id = newId();
    copy.name = `${src.name} copy`;
    // new object ids, so rules that point at objects of the copy stay inside the copy
    const ids = new Map<string, string>();
    for (const o of copy.objects) {
      const id = newId();
      ids.set(o.id, id);
      o.id = id;
    }
    for (const o of copy.objects) {
      for (const r of o.rules) for (const a of r.actions) if ('target' in a && a.target) a.target = ids.get(a.target) ?? a.target;
    }
    this.project.levels.splice(this.levelIndex + 1, 0, copy);
    this.commitLevel('duplicate-level');
    this.setLevel(this.levelIndex + 1);
  }

  /** False when it is the last level (a project always has one). */
  removeLevel(): boolean {
    if (this.project.levels.length <= 1) return false;
    const [gone] = this.project.levels.splice(this.levelIndex, 1);
    // exits that led to the deleted level go to "the next level" instead
    if (gone) {
      for (const l of this.project.levels) {
        for (const o of l.objects) for (const r of o.rules) for (const a of r.actions) if (a.type === 'level' && a.level === gone.id) a.level = '';
      }
    }
    this.levelIndex = Math.min(this.levelIndex, this.project.levels.length - 1);
    this.selection = { kind: 'none' };
    this.extraSelected = [];
    this.commitLevel('remove-level');
    this.emit({ type: 'level-restored' });
    this.emit({ type: 'levels-changed' });
    this.emit({ type: 'selection' });
    return true;
  }

  renameLevel(name: string): void {
    const clean = name.trim();
    if (!clean || clean === this.level.name) return;
    this.level.name = clean;
    this.commitLevel('rename-level');
    this.emit({ type: 'levels-changed' });
  }

  /** Fog, sun, ambient light or shadows of the level being edited changed (an undo step per field). */
  lookChanged(): void {
    this.commitLevel('edit:look');
    this.emit({ type: 'sky-changed' });
  }

  /** The sky color of the level being edited. */
  setSky(color: string): void {
    if (this.level.sky === color) return;
    this.level.sky = color;
    this.commitLevel('edit:sky');
    this.emit({ type: 'sky-changed' });
  }

  /** A time of day: the sky color, its style and the light that goes with it, as one undo step. */
  applySkyPreset(preset: SkyPreset): void {
    this.level.sky = preset.sky;
    Object.assign(this.level.look, preset.look, { fogColor: null, skyTexture: null });
    this.commitLevel('edit:sky-preset');
    this.emit({ type: 'sky-changed' });
    // the color of the sky is also shown in the level list
    this.emit({ type: 'levels-changed' });
  }

  /** Move the current level earlier (-1) or later (+1) in the play order. */
  moveLevel(delta: -1 | 1): void {
    const to = this.levelIndex + delta;
    if (to < 0 || to >= this.project.levels.length) return;
    const [l] = this.project.levels.splice(this.levelIndex, 1);
    this.project.levels.splice(to, 0, l!);
    this.levelIndex = to;
    this.commitLevel('move-level');
    this.emit({ type: 'levels-changed' });
  }

  selectedObject(): LevelObject | undefined {
    return this.selection.kind === 'object' ? this.getObject(this.selection.id) : undefined;
  }

  addObject(obj: LevelObject): void {
    this.objects.push(obj);
    this.emit({ type: 'object-added', id: obj.id });
    this.commitLevel('add');
    this.select({ kind: 'object', id: obj.id });
  }

  duplicateObject(id: string): void {
    this.duplicateObjects([id]);
  }

  /** Copies of the objects, a meter aside; rules of the copies that point at one of the originals point at its copy. */
  duplicateObjects(ids: string[]): void {
    const sources = this.objects.filter((o) => ids.includes(o.id));
    if (sources.length === 0) return;
    const idMap = new Map<string, string>();
    const copies = sources.map((src) => {
      const copy: LevelObject = structuredClone(src);
      copy.id = newId();
      idMap.set(src.id, copy.id);
      copy.name = `${src.name} copy`;
      copy.position = [src.position[0] + 1, src.position[1], src.position[2] + 1];
      if (copy.kind === 'model') {
        // a copy of an instance is another instance (never a master); a copy of a plain object has shapes of its own
        delete copy.master;
        const model = this.getModel(copy.modelId);
        if (model && !isComponent(model)) {
          const own = cloneModel(model);
          own.name = model.name;
          this.project.models.push(own);
          this.emit({ type: 'model-added', id: own.id });
          copy.modelId = own.id;
        }
      }
      return copy;
    });
    for (const c of copies) {
      for (const r of c.rules) for (const a of r.actions) if ('target' in a && a.target) a.target = idMap.get(a.target) ?? a.target;
    }
    for (const c of copies) {
      this.objects.push(c);
      this.emit({ type: 'object-added', id: c.id });
    }
    this.commitLevel('add');
    this.selectObjects(copies.map((c) => c.id));
  }

  /** Remove every object in the list (one undo step). */
  removeObjects(ids: string[]): void {
    const doomed = this.objects.filter((o) => ids.includes(o.id));
    if (doomed.length === 0) return;
    this.objects.splice(0, this.objects.length, ...this.objects.filter((o) => !ids.includes(o.id)));
    this.extraSelected = this.extraSelected.filter((id) => !ids.includes(id));
    if (this.selection.kind === 'object' && ids.includes(this.selection.id)) {
      const next = this.extraSelected.shift();
      this.selection = next ? { kind: 'object', id: next } : { kind: 'none' };
    }
    for (const o of doomed) this.emit({ type: 'object-removed', id: o.id });
    this.commitLevel('remove');
    this.emit({ type: 'selection' });
  }

  removeObject(id: string): void {
    this.removeObjects([id]);
  }

  getModel(id: string): Model | undefined {
    return this.project.models.find((m) => m.id === id);
  }

  addModel(model: Model): void {
    this.project.models.push(model);
    this.emit({ type: 'model-added', id: model.id });
  }

  /** Removes the model and every level instance of it; clears it from the player if used there. */
  removeModel(id: string): void {
    const i = this.project.models.findIndex((m) => m.id === id);
    if (i < 0) return;
    // the instances of every level go with it (removeObject works on the level being edited)
    const here = this.levelIndex;
    for (let li = 0; li < this.project.levels.length; li++) {
      const objs = this.project.levels[li]!.objects;
      const doomed = objs.filter((o) => o.kind === 'model' && o.modelId === id).map((o) => o.id);
      if (doomed.length === 0) continue;
      if (li === here) {
        this.removeObjects(doomed);
      } else {
        this.project.levels[li]!.objects = objs.filter((o) => !doomed.includes(o.id));
        this.commitLevel('remove');
      }
    }
    if (this.project.player.modelId === id) {
      this.project.player.modelId = null;
      this.emit({ type: 'player-changed' });
    }
    // variants of it and components that hold it as a part lose it (they keep what they have of their own)
    for (const m of this.project.models) {
      if (m.variantOf === id) delete m.variantOf;
      if (m.parts) {
        m.parts = m.parts.filter((p) => p.modelId !== id);
        if (m.parts.length === 0) delete m.parts;
      }
    }
    this.project.models.splice(i, 1);
    this.emit({ type: 'model-removed', id });
  }

  addTexture(tex: ProjectTexture): void {
    this.project.textures.push(tex);
    this.emit({ type: 'texture-changed', name: tex.name, structural: true });
  }

  removeTexture(name: string): void {
    const i = this.project.textures.findIndex((t) => t.name === name);
    if (i < 0) return;
    this.project.textures.splice(i, 1);
    this.emit({ type: 'texture-changed', name, structural: true });
  }

  textureChanged(name: string, structural: boolean): void {
    this.emit({ type: 'texture-changed', name, structural });
  }

  modelChanged(id: string, structural: boolean): void {
    this.emit({ type: 'model-changed', id, structural });
  }

  // ---------------------------------------------------------------- components

  /**
   * The object becomes a component: a block turns into a one-shape model, a model placement makes its model one.
   * The object stays where it is as the master placement. Returns the id of the component, or null when it cannot be one.
   */
  makeComponent(objectId: string): string | null {
    const obj = this.getObject(objectId);
    if (!obj) return null;
    if (obj.kind === 'block') {
      if (obj.terrain) return null; // a sculpted ground belongs to its place
      const { model, instance } = componentFromBlock(obj, newId);
      this.project.models.push(model);
      const at = this.objects.indexOf(obj);
      this.objects[at] = instance;
      this.emit({ type: 'model-added', id: model.id });
      this.emit({ type: 'object-changed', id: instance.id });
      this.commitLevel('make-component');
      return model.id;
    }
    const model = this.getModel(obj.modelId);
    if (!model) return null;
    if (!isComponent(model)) {
      componentFromInstance(model, obj, newId);
      this.commitLevel('make-component');
      this.emit({ type: 'components-changed', id: model.id });
      this.emit({ type: 'object-changed', id: obj.id });
    }
    return model.id;
  }

  /** A model is a component (or not any more). Placed instances keep what they have. */
  setComponent(modelId: string, on: boolean): void {
    const m = this.getModel(modelId);
    if (!m || isComponent(m) === on) return;
    if (on) m.component = true;
    else {
      delete m.component;
      for (const inst of instancesOf(this.project.levels, modelId)) delete inst.master;
    }
    this.commitLevel('component');
    this.emit({ type: 'components-changed', id: modelId });
  }

  /**
   * The look or the default behavior of a component was edited: its instances follow (what an instance sets itself
   * stays). One undo step per field, merged while typing.
   */
  componentChanged(modelId: string, label = 'edit:component'): void {
    const m = this.getModel(modelId);
    if (!m) return;
    const changed = syncInstances(this.project.levels, m, newId);
    for (const o of changed) if (this.getObject(o.id)) this.emit({ type: 'object-changed', id: o.id });
    this.commitLevel(`${label}:${modelId}`);
    this.emit({ type: 'components-changed', id: modelId });
  }

  /** The look of a component (tile, tint, mapping ...) changed: it is drawn again everywhere. */
  componentLookChanged(modelId: string, label = 'edit:look'): void {
    this.modelChanged(modelId, true);
    this.commitLevel(`${label}:${modelId}`);
    this.emit({ type: 'components-changed', id: modelId });
  }

  /** A variant of a component, as a new component (its own look and behavior, the shapes of the component). */
  addVariant(baseId: string): string | null {
    const base = this.getModel(baseId);
    if (!base) return null;
    const v = makeVariant(base, newId);
    this.project.models.push(v);
    this.commitLevel('add-variant');
    this.emit({ type: 'model-added', id: v.id });
    return v.id;
  }

  /** The instance sets this itself from now on. */
  overrideInstance(objectId: string, key: InstanceOverride): void {
    const o = this.getObject(objectId);
    if (!o || o.kind !== 'model') return;
    setOverride(o, key);
  }

  /** The instance follows its component again (for one thing, or for everything). */
  resetInstance(objectId: string, key?: InstanceOverride): void {
    const o = this.getObject(objectId);
    if (!o || o.kind !== 'model') return;
    const m = this.getModel(o.modelId);
    if (!m) return;
    clearOverride(o, m, newId, key);
    this.emit({ type: 'object-changed', id: o.id });
    this.commitLevel('reset-instance');
  }

  /** The instance becomes an object of its own: it gets shapes of its own and no longer follows the component. */
  detachInstance(objectId: string): boolean {
    const o = this.getObject(objectId);
    if (!o || o.kind !== 'model') return false;
    const m = this.getModel(o.modelId);
    if (!m) return false;
    const own = cloneModel(m);
    own.name = m.name;
    delete own.component;
    this.project.models.push(own);
    o.modelId = own.id;
    delete o.master;
    delete o.overrides;
    this.emit({ type: 'model-added', id: own.id });
    this.emit({ type: 'object-changed', id: o.id });
    this.commitLevel('detach');
    return true;
  }

  /** The master placement of a component in the level being edited, if there is one. */
  masterOf(modelId: string): LevelModelInstance | undefined {
    return instancesOf(this.project.levels, modelId).find((o) => o.master === true);
  }

  /** A built-in component back to how it came (shapes, look and behavior). */
  resetBuiltIn(modelId: string): boolean {
    const kind = presetOfModel(modelId);
    const m = this.getModel(modelId);
    if (!kind || !m) return false;
    const fresh = builtInComponent(kind, newId);
    Object.assign(m, { ...fresh, name: m.name });
    this.componentChanged(modelId, 'reset-component');
    this.modelChanged(modelId, true);
    return true;
  }

  /**
   * Resize the shape of a component made of one shape (a block-like one) to this size in meters: every instance
   * follows. Returns false when the component has more than one shape (resize the placement instead).
   */
  resizeComponent(modelId: string, size: [number, number, number]): boolean {
    const m = this.getModel(modelId);
    if (!m || m.cubes.length !== 1) return false;
    scaleMeshToSize(m.cubes[0]!.mesh, size);
    this.modelChanged(modelId, true);
    this.commitLevel(`edit:size:${modelId}`);
    this.emit({ type: 'components-changed', id: modelId });
    return true;
  }

  /** Is this one of the built-in game objects (it can be put back as it came)? */
  canResetBuiltIn(modelId: string): boolean {
    return presetOfModel(modelId) !== null;
  }

  /** Models that depend on this one (variants, holders of it as a part). */
  dependents(modelId: string): string[] {
    return dependentsOf(this.project.models, modelId);
  }

  /** A new placement of a model: an instance with its defaults. A plain object placed again gets shapes of its own. */
  placeModelAt(modelId: string, at: [number, number, number]): LevelModelInstance | null {
    let model = this.getModel(modelId);
    if (!model) return null;
    if (!isComponent(model) && instancesOf(this.project.levels, model.id).length > 0) {
      const own = cloneModel(model);
      own.name = model.name;
      this.addModel(own);
      model = own;
    }
    const inst = placeInstance(model, at, newId);
    this.addObject(inst);
    return inst;
  }

  // ---------------------------------------------------------------- variables

  addVariable(): string {
    const names = new Set(this.project.variables.map((v) => v.name));
    let name = 'score';
    for (let n = 2; names.has(name); n++) name = `score ${n}`;
    const v = { id: newId(), name, initial: 0, min: 0, max: null, hud: true, icon: '', label: '' };
    this.project.variables.push(v);
    this.commitLevel('add-variable');
    this.emit({ type: 'variables-changed' });
    return v.id;
  }

  removeVariable(id: string): void {
    this.project.variables = this.project.variables.filter((v) => v.id !== id);
    this.commitLevel('remove-variable');
    this.emit({ type: 'variables-changed' });
  }

  /** Rename a variable and every rule that mentions it. False when the name is empty or taken. */
  renameVariable(id: string, name: string): boolean {
    const v = this.project.variables.find((x) => x.id === id);
    const clean = name.trim();
    if (!v || !clean || this.project.variables.some((x) => x !== v && x.name === clean)) return false;
    if (v.name !== clean) {
      for (const l of this.project.levels) for (const o of l.objects) renameVariableInRules(o.rules, v.name, clean);
      v.name = clean;
      this.commitLevel('rename-variable');
    }
    this.emit({ type: 'variables-changed' });
    return true;
  }

  /** A sound was added, removed or edited. */
  soundsChanged(): void {
    this.emit({ type: 'sounds-changed' });
  }

  /** Something other than the name of a variable changed (start value, limits, how it looks). */
  variablesChanged(): void {
    this.commitLevel('edit:variables');
    this.emit({ type: 'variables-changed' });
  }

  /**
   * Rename a bone: clips and the player's attachments refer to bones by name, so they follow.
   * Returns false when the name is empty or already used by another bone of the model.
   */
  renameBone(modelId: string, boneId: string, name: string): boolean {
    const model = this.getModel(modelId);
    if (!model) return false;
    const old = renameBoneInModel(model, boneId, name);
    if (old === null) return false;
    const clean = name.trim();
    if (old !== clean && this.project.player.modelId === modelId) {
      for (const a of this.project.player.attachments) if (a.bone === old) a.bone = clean;
    }
    // bone names are baked into the rig renders and the instances that play clips
    this.modelChanged(modelId, true);
    return true;
  }

  countInstances(modelId: string): number {
    return this.project.levels.reduce((n, l) => n + l.objects.filter((o) => o.kind === 'model' && o.modelId === modelId).length, 0);
  }

  /** An object was edited through the inspector (records an undo step). */
  objectChanged(id: string): void {
    this.emit({ type: 'object-changed', id });
    this.commitLevel(`edit:${id}`);
  }
  playerChanged(): void {
    this.emit({ type: 'player-changed' });
    this.commitLevel('edit:player');
  }
  settingsChanged(): void {
    this.emit({ type: 'settings-changed' });
  }
}
