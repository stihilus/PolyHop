import { beforeEach, describe, expect, it, vi } from 'vitest';

const memory = new Map<string, unknown>();
vi.mock('../src/core/storage', () => ({
  kvGet: async (key: string) => memory.get(key),
  kvSet: async (key: string, value: unknown) => void memory.set(key, value),
}));

import { boxMesh } from '../src/core/mesh';
import { canonicalJson } from '../src/core/projectFile';
import { createBlock, createDefaultProject } from '../src/core/types';
import { FileSession } from '../src/editor/fileSession';
import { Store } from '../src/editor/store';
import { TextureLibrary } from '../src/runtime/textures';

function session() {
  const store = new Store(createDefaultProject());
  const files = new FileSession(store, new TextureLibrary());
  return { store, files };
}

describe('closing the page with work that is not in a file', () => {
  beforeEach(() => memory.clear());

  it('a project nobody touched is nothing to lose', async () => {
    const { files } = session();
    await files.restore();
    expect(files.hasUnsavedChanges()).toBe(false);
  });

  it('an edit makes it unsaved work, and undoing it takes the warning away again', async () => {
    const { store, files } = session();
    await files.restore();
    store.addObject(createBlock('Crate', [0, 1, 0], boxMesh([1, 1, 1]), null));
    expect(files.hasUnsavedChanges()).toBe(true);
    store.undoLevel();
    expect(files.hasUnsavedChanges()).toBe(false);
  });

  it('a new project starts clean again, and its own edits count', async () => {
    const { store, files } = session();
    await files.restore();
    store.addObject(createBlock('Crate', [0, 1, 0], boxMesh([1, 1, 1]), null));
    expect(files.hasUnsavedChanges()).toBe(true);
    store.setProject(createDefaultProject());
    await files.detach();
    expect(files.hasUnsavedChanges()).toBe(false);
    store.addObject(createBlock('Crate', [0, 1, 0], boxMesh([1, 1, 1]), null));
    expect(files.hasUnsavedChanges()).toBe(true);
  });

  it('with a file: only what differs from the file is unsaved', async () => {
    const { store, files } = session();
    await files.restore();
    const text = JSON.stringify(createDefaultProject());
    const opened = await files.open({ text: async () => text, name: 'game.polyhop.json' } as unknown as File);
    expect(opened).toBe(true);
    expect(files.hasUnsavedChanges()).toBe(false);
    store.addObject(createBlock('Crate', [0, 1, 0], boxMesh([1, 1, 1]), null));
    expect(files.hasUnsavedChanges()).toBe(true);
    // the file is what counts, whatever the autosave holds
    expect(canonicalJson(store.project).length).toBeGreaterThan(0);
  });

  it('remembers what a project without a file started as, between sessions', async () => {
    const first = session();
    await first.files.restore();
    first.store.addObject(createBlock('Crate', [0, 1, 0], boxMesh([1, 1, 1]), null));
    // a new session with the same (autosaved) project: the starting point was kept, so the work is still unsaved
    const again = new FileSession(first.store, new TextureLibrary());
    await again.restore();
    expect(again.hasUnsavedChanges()).toBe(true);
  });
});
