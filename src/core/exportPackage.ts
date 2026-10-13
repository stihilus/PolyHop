// What an exported game is made of. Pure functions (no DOM), so they can be tested and used anywhere:
// the editor fetches the player script and the font, this module puts the files together.

import { zipSync } from 'fflate';

export interface ExportOptions {
  /** Show the list of controls on the start screen. */
  showControls: boolean;
  /** Page color around the game. */
  background: string;
}

export const DEFAULT_EXPORT_OPTIONS: ExportOptions = { showControls: true, background: '#14161b' };

export const PLAYER_FILE = 'player.js';
export const FONT_FILE = 'DepartureMono-Regular.otf';

/** JSON that is safe inside a <script> element: no `</script>` or `<!--` can be formed. */
export function jsonForHtml(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

const escapeText = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export interface PageInput {
  title: string;
  /** The project as JSON text (already built, may contain embedded textures). */
  projectJson: string;
  options: ExportOptions;
  /** Name of the font file next to the page, or null for no custom font. */
  fontFile: string | null;
  /** How the player script is loaded; `player.js` in an export. */
  scriptSrc: string;
}

/** The page of the exported game. The project travels inside it, so there is nothing to fetch. */
export function playerHtml(input: PageInput): string {
  const color = /^#[0-9a-fA-F]{3,8}$/.test(input.options.background) ? input.options.background : '#14161b';
  const font = input.fontFile
    ? `@font-face{font-family:'Departure Mono';src:url('${input.fontFile}') format('opentype');font-display:swap}`
    : '';
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeText(input.title)}</title>
<style>
${font}
html,body{margin:0;height:100%;background:${color};overflow:hidden;overscroll-behavior:none;touch-action:none;-webkit-user-select:none;user-select:none;font-family:'Departure Mono',ui-monospace,Menlo,Consolas,monospace}
#game{position:relative;width:100%;height:100%}
canvas{display:block;width:100%;height:100%;touch-action:none}
</style>
</head>
<body>
<div id="game"></div>
<script type="application/json" id="polyhop-options">${jsonForHtml(input.options)}</script>
<script type="application/json" id="polyhop-project">${input.projectJson.replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029')}</script>
<script src="${input.scriptSrc}"></script>
</body>
</html>
`;
}

export interface PackageInput {
  title: string;
  projectJson: string;
  options: ExportOptions;
  playerJs: Uint8Array;
  /** Font file bytes, or null to leave the font out. */
  font: Uint8Array | null;
}

/** The files of an export, by path. */
export function packageFiles(input: PackageInput): Record<string, Uint8Array> {
  const enc = new TextEncoder();
  const html = playerHtml({
    title: input.title,
    projectJson: input.projectJson,
    options: input.options,
    fontFile: input.font ? FONT_FILE : null,
    scriptSrc: PLAYER_FILE,
  });
  const files: Record<string, Uint8Array> = {
    'index.html': enc.encode(html),
    [PLAYER_FILE]: input.playerJs,
  };
  if (input.font) files[FONT_FILE] = input.font;
  return files;
}

/** A zip with the files at its top level, as itch.io wants an HTML5 game. */
export function zipPackage(files: Record<string, Uint8Array>): Uint8Array {
  const entries: Record<string, Uint8Array> = {};
  for (const [name, data] of Object.entries(files)) entries[name] = data;
  return zipSync(entries, { level: 6 });
}

/** `My Platformer` -> `my-platformer-html5.zip` */
export function exportFileName(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/đ/g, 'dj')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // č -> c, ž -> z
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return `${slug || 'game'}-html5.zip`;
}
