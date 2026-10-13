import './editor/styles.css';
import { canonicalJson } from './core/projectFile';
import { kvGet, kvSet } from './core/storage';
import { type Project, createDefaultProject, normalizeProject } from './core/types';
import { EditorApp } from './editor/app';
import { FileSession } from './editor/fileSession';
import { Store } from './editor/store';
import { TextureLibrary } from './runtime/textures';

const PROJECT_KEY = 'project';

async function main(): Promise<void> {
  const root = document.getElementById('app')!;

  // Every PNG in assets/textures is available as an atlas. Drop more files there and rebuild.
  const textures = new TextureLibrary();
  const found = import.meta.glob('/assets/textures/*.png', { eager: true, query: '?url', import: 'default' }) as Record<string, string>;
  // the main atlas first, then the other general ones, then the special ones (skins, pickups, plants, props)
  const rank = (name: string) => (name === 'Textures-16.png' ? 0 : /^(Humanoid|Character|Items|Plants|Props|Kit|Demo)-/i.test(name) ? 2 : 1);
  const atlases = Object.entries(found)
    .map(([path, url]) => ({ name: path.split('/').pop()!, url }))
    .sort((a, b) => rank(a.name) - rank(b.name) || a.name.localeCompare(b.name));
  for (const a of atlases) textures.register(a.name, a.url);
  await textures.preload();

  const saved = await kvGet<Project>(PROJECT_KEY);
  const project = saved ? normalizeProject(saved) : createDefaultProject();
  const store = new Store(project);
  textures.bind(() => store.project.textures); // project textures shadow built-in atlases by name
  const files = new FileSession(store, textures);
  await files.restore();
  const app = new EditorApp(root, store, textures, files);
  if (import.meta.env.DEV) (window as unknown as Record<string, unknown>).__app = { app, store, textures };
  // closing the page with work that is not in a file: the browser asks first (the autosave can be cleared with the site data)
  window.addEventListener('beforeunload', (e) => {
    if (!files.hasUnsavedChanges()) return;
    e.preventDefault();
    e.returnValue = '';
  });
  // nothing saved yet: the first visit. Ask whether to start blank or from the example.
  if (!saved && files.state().name === null) app.showStartDialog(true);

  // Backup autosave (debounced) to IndexedDB on any change except selection. The project file itself
  // is only written when the user presses Save (see FileSession).
  let timer: number | undefined;
  store.subscribe((e) => {
    if (e.type === 'selection') return;
    files.markEdited();
    window.clearTimeout(timer);
    timer = window.setTimeout(async () => {
      const json = canonicalJson(store.project);
      await kvSet(PROJECT_KEY, JSON.parse(json));
      files.checkpoint(json);
    }, 400);
  });
}

main().catch((err) => {
  console.error(err);
  document.getElementById('app')!.textContent = `Failed to start: ${err instanceof Error ? err.message : err}`;
});
