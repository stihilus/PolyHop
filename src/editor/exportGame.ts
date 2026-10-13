import {
  DEFAULT_EXPORT_OPTIONS,
  type ExportOptions,
  exportFileName,
  packageFiles,
  zipPackage,
} from '../core/exportPackage';
import fontUrl from '../../assets/fonts/Inter.woff2?url';
import type { FileSession } from './fileSession';
import type { Store } from './store';

export { DEFAULT_EXPORT_OPTIONS, type ExportOptions };

async function fetchBytes(url: string): Promise<Uint8Array | null> {
  try {
    const r = await fetch(url);
    return r.ok ? new Uint8Array(await r.arrayBuffer()) : null;
  } catch {
    return null;
  }
}

export interface ExportResult {
  fileName: string;
  bytes: number;
  files: string[];
}

/** Build the zip of the game and hand it to the browser as a download. */
export async function exportGame(store: Store, files: FileSession, options: ExportOptions): Promise<ExportResult> {
  // the player is built next to the editor (npm run build:player); both dev and the built editor serve it
  const playerJs = await fetchBytes(new URL('player/player.js', document.baseURI).href);
  if (!playerJs) throw new Error('The game player (player/player.js) was not found. Run "npm run build:player" and reload the editor.');
  const font = await fetchBytes(fontUrl);
  // like a project file (the atlases the game uses are inside it), without what only the editor needs
  const projectJson = files.serializeForExport();
  const title = store.project.settings.name || 'Game';
  const data = packageFiles({ title, projectJson, options, playerJs, font });
  const zip = zipPackage(data);

  const fileName = exportFileName(title);
  const url = URL.createObjectURL(new Blob([zip.slice().buffer as ArrayBuffer], { type: 'application/zip' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  return { fileName, bytes: zip.length, files: Object.keys(data) };
}
