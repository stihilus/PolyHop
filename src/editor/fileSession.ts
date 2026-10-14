import {
  PROJECT_FILE_SUFFIX,
  canonicalJson,
  hashText,
  parseProjectText,
  projectFileName,
  serializeProject,
} from '../core/projectFile';
import { kvGet, kvSet } from '../core/storage';
import { pruneForExport } from '../core/exportProject';
import { type Project, type ProjectTexture, normalizeProject } from '../core/types';
import type { TextureLibrary } from '../runtime/textures';
import { appAlert } from './ui/dialogs';
import type { Store } from './store';

// Minimal typings for the File System Access API (not in lib.dom for every TypeScript version).
interface WritableLike {
  write(data: string): Promise<void>;
  close(): Promise<void>;
}
interface FileHandleLike {
  readonly name: string;
  createWritable(): Promise<WritableLike>;
  getFile(): Promise<File>;
  queryPermission?(opts: { mode: 'readwrite' }): Promise<PermissionState>;
  requestPermission?(opts: { mode: 'readwrite' }): Promise<PermissionState>;
}
interface PickerWindow {
  showSaveFilePicker?(opts: unknown): Promise<FileHandleLike>;
  showOpenFilePicker?(opts: unknown): Promise<FileHandleLike[]>;
}

const KEY_HANDLE = 'file-handle';
const KEY_NAME = 'file-name';
const KEY_HASH = 'file-hash';
/** What a project that has no file looked like when it was made: only changes beyond it can be lost. */
const KEY_BASE = 'base-hash';
const PICKER_TYPES = [{ description: 'PolyHop project', accept: { 'application/json': ['.json'] } }];

export type SaveOutcome = 'saved' | 'downloaded' | 'cancelled' | 'failed';

export interface FileState {
  /** Name of the file the project is saved to, or null when it never was. */
  name: string | null;
  /** The project changed since it was last saved to the file. */
  dirty: boolean;
  /** True when Save overwrites the same file; false when every Save downloads a copy. */
  overwrites: boolean;
}

function isAbort(err: unknown): boolean {
  return err instanceof DOMException && err.name === 'AbortError';
}

/**
 * Saving and opening the project as a file. In browsers with the File System Access API (Chrome,
 * Edge) Save writes into the same file every time; elsewhere it downloads a new copy. The project is
 * also autosaved in the browser (see main.ts) as a backup, independent of this class.
 */
export class FileSession {
  onChange?: () => void;

  private handle: FileHandleLike | null = null;
  private name: string | null = null;
  private savedHash: string | null = null;
  private baselineHash: string | null = null;
  private dirty = false;
  private builtinCache = new Map<string, ProjectTexture | null>();

  constructor(
    private store: Store,
    private textures: TextureLibrary,
  ) {}

  get supported(): boolean {
    const w = window as unknown as PickerWindow;
    return typeof w.showSaveFilePicker === 'function' && typeof w.showOpenFilePicker === 'function';
  }

  state(): FileState {
    return { name: this.name, dirty: this.dirty, overwrites: !!this.handle };
  }

  /** Restore the file the project was last saved to (call once at start, after the project loaded). */
  async restore(): Promise<void> {
    this.handle = ((await kvGet<FileHandleLike>(KEY_HANDLE)) as FileHandleLike | undefined) ?? null;
    this.name = (await kvGet<string>(KEY_NAME)) ?? this.handle?.name ?? null;
    this.savedHash = (await kvGet<string>(KEY_HASH)) ?? null;
    this.dirty = this.name === null || this.savedHash !== hashText(canonicalJson(this.store.project));
    this.baselineHash = (await kvGet<string>(KEY_BASE)) ?? null;
    if (this.baselineHash === null) {
      // the first time with this feature (or a first visit): what is open now is the starting point
      this.baselineHash = hashText(canonicalJson(this.store.project));
      await kvSet(KEY_BASE, this.baselineHash);
    }
    this.onChange?.();
  }

  /**
   * Is there work that would be lost if the page closed now? With a file: the project differs from what was
   * written to it. Without one: it differs from the project the session started with (the autosave in the
   * browser is only a backup, and clearing the site data removes it).
   */
  hasUnsavedChanges(): boolean {
    const reference = this.name !== null ? this.savedHash : this.baselineHash;
    if (reference === null) return false;
    return hashText(canonicalJson(this.store.project)) !== reference;
  }

  /** The project was edited: mark it dirty right away, `checkpoint` settles it after the autosave. */
  markEdited(): void {
    if (this.dirty) return;
    this.dirty = true;
    this.onChange?.();
  }

  /** Called after the debounced autosave with `canonicalJson(project)`: undoing back to the saved state is clean again. */
  checkpoint(json: string): void {
    const dirty = this.name === null || this.savedHash !== hashText(json);
    if (dirty === this.dirty) return;
    this.dirty = dirty;
    this.onChange?.();
  }

  // ---------------------------------------------------------------- saving

  private builtin(name: string): ProjectTexture | null {
    if (this.builtinCache.has(name)) return this.builtinCache.get(name)!;
    let tex: ProjectTexture | null = null;
    const info = this.textures.isBuiltin(name) ? this.textures.get(name) : null;
    const pixels = info ? this.textures.builtinPixels(name) : null;
    if (info && pixels) tex = { name, tileSize: info.tileSize, pixels };
    this.builtinCache.set(name, tex);
    return tex;
  }

  /** Everything the project file contains, as text. */
  /** The text of a game to export: the project without what only the editor needs. */
  serializeForExport(): string {
    return serializeProject(pruneForExport(this.store.project), (n) => this.builtin(n));
  }

  serialize(): string {
    return serializeProject(this.store.project, (n) => this.builtin(n));
  }

  private async persist(): Promise<void> {
    await kvSet(KEY_NAME, this.name);
    await kvSet(KEY_HASH, this.savedHash);
    if (this.handle) await kvSet(KEY_HANDLE, this.handle);
    else await kvSet(KEY_HANDLE, null);
  }

  private async writeTo(handle: FileHandleLike, text: string): Promise<void> {
    const w = await handle.createWritable();
    await w.write(text);
    await w.close();
  }

  private async mayWrite(handle: FileHandleLike): Promise<boolean> {
    try {
      const opts = { mode: 'readwrite' } as const;
      if ((await handle.queryPermission?.(opts)) === 'granted') return true;
      return (await handle.requestPermission?.(opts)) === 'granted';
    } catch {
      return false;
    }
  }

  private download(text: string, name: string): void {
    const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  /** Save into the current file, asking for one the first time. `asNew` always asks (Save As). */
  async save(asNew = false): Promise<SaveOutcome> {
    const plainHash = hashText(canonicalJson(this.store.project));
    const text = this.serialize();
    const suggested = this.name ?? projectFileName(this.store.project.settings.name);
    let target: FileHandleLike | null = !asNew && this.handle && (await this.mayWrite(this.handle)) ? this.handle : null;
    let outcome: SaveOutcome = 'saved';

    try {
      if (!target) {
        const w = window as unknown as PickerWindow;
        if (w.showSaveFilePicker) {
          try {
            target = await w.showSaveFilePicker({ suggestedName: suggested, types: PICKER_TYPES });
          } catch (err) {
            if (isAbort(err)) return 'cancelled';
            console.warn('File picker unavailable, downloading instead', err);
          }
        }
      }
      if (target) {
        await this.writeTo(target, text);
        this.handle = target;
        this.name = target.name;
      } else {
        const name = suggested.endsWith('.json') ? suggested : `${suggested}${PROJECT_FILE_SUFFIX}`;
        this.download(text, name);
        this.handle = null;
        this.name = name;
        outcome = 'downloaded';
      }
    } catch (err) {
      console.error('Save failed', err);
      await appAlert(`Could not save the project: ${err instanceof Error ? err.message : err}`, { title: 'Save failed' });
      return 'failed';
    }

    this.savedHash = plainHash;
    this.dirty = hashText(canonicalJson(this.store.project)) !== plainHash;
    await this.persist();
    this.onChange?.();
    return outcome;
  }

  // ---------------------------------------------------------------- opening / new

  private async load(text: string, handle: FileHandleLike | null, fileName: string): Promise<void> {
    const project: Project = normalizeProject(parseProjectText(text));
    this.store.setProject(project);
    this.handle = handle;
    this.name = fileName;
    this.savedHash = hashText(canonicalJson(this.store.project));
    this.dirty = false;
    await this.persist();
    this.onChange?.();
  }

  /** Ask for a project file and replace the current project with it. Returns false when cancelled. */
  async open(fallbackFile?: File): Promise<boolean> {
    try {
      if (fallbackFile) {
        await this.load(await fallbackFile.text(), null, fallbackFile.name);
        return true;
      }
      const w = window as unknown as PickerWindow;
      if (!w.showOpenFilePicker) return false;
      const [handle] = await w.showOpenFilePicker({ types: PICKER_TYPES, multiple: false });
      if (!handle) return false;
      const file = await handle.getFile();
      await this.load(await file.text(), handle, handle.name);
      return true;
    } catch (err) {
      if (isAbort(err)) return false;
      await appAlert(`Could not open the project: ${err instanceof Error ? err.message : err}`, { title: 'Open failed' });
      return false;
    }
  }

  /** The project was replaced by a new one that has no file yet. */
  async detach(): Promise<void> {
    this.handle = null;
    this.name = null;
    this.savedHash = null;
    this.baselineHash = hashText(canonicalJson(this.store.project));
    this.dirty = true;
    await this.persist();
    await kvSet(KEY_BASE, this.baselineHash);
    this.onChange?.();
  }
}
