import type { Project, ProjectTexture } from './types';

/** Suggested extension of a saved project. The content is plain JSON, so `.json` opens it too. */
export const PROJECT_FILE_SUFFIX = '.polyhop.json';

/** `My Platformer` -> `My Platformer.polyhop.json`, with characters that file systems reject removed. */
export function projectFileName(projectName: string): string {
  const base = projectName.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '-').trim().replace(/^\.+/, '');
  return `${base || 'project'}${PROJECT_FILE_SUFFIX}`;
}

/** Names of the atlases the level and the models sample from. */
export function usedTextureNames(project: Project): string[] {
  const names = new Set<string>();
  for (const l of project.levels) {
    for (const o of l.objects) {
      if (o.kind !== 'block') continue;
      if (o.tile) names.add(o.tile.texture);
      for (const f of o.mesh.faces) if (f.tile) names.add(f.tile.texture);
    }
  }
  for (const m of project.models) if (m.texture) names.add(m.texture);
  if (project.player.skin) names.add(project.player.skin);
  return [...names];
}

/**
 * The text written to a project file: the whole project (settings, player, level, models and every
 * texture). Built-in atlases that the project uses but does not own yet are copied in, so the file
 * still looks right on a machine that does not have the same `assets/textures`.
 * `builtin` returns the pixels of a built-in atlas (or null if there is none by that name).
 */
export function serializeProject(project: Project, builtin: (name: string) => ProjectTexture | null): string {
  const have = new Set(project.textures.map((t) => t.name));
  const extra: ProjectTexture[] = [];
  for (const name of usedTextureNames(project)) {
    if (have.has(name)) continue;
    const tex = builtin(name);
    if (tex) extra.push(tex);
  }
  return JSON.stringify(extra.length ? { ...project, textures: [...project.textures, ...extra] } : project);
}

/** Parse the text of a project file (throws a readable error when it is not a project). */
export function parseProjectText(text: string): unknown {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('this is not a JSON file');
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('this file does not contain a project');
  const p = data as Record<string, unknown>;
  if (!('level' in p) && !('models' in p) && !('player' in p) && !('textures' in p)) {
    throw new Error('this file does not look like a project');
  }
  return data;
}

/** JSON with object keys sorted, so two projects with the same content always give the same text. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : v,
  );
}

/** Small non-cryptographic hash (cyrb53) used to tell whether the project changed since it was saved. */
export function hashText(text: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return `${text.length.toString(36)}-${(4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36)}`;
}
