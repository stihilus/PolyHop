// What goes into an exported game: the project without the parts only the editor needs (models nobody places,
// the default behavior of components, textures and sounds nothing uses). The game plays exactly the same.

import { dependenciesOf } from './components';
import { type Action, SILENT_VOICE } from './logic';
import { SOUND_IDS } from './sounds';
import type { Project } from './types';

function soundsOfActions(actions: Action[], out: Set<string>): void {
  for (const a of actions) {
    if (a.type === 'sound' && a.sound) out.add(a.sound);
    else if (a.type === 'dialogue' || a.type === 'choice') {
      // the voice of a character: the one picked, or the plain blip
      if (a.voice !== SILENT_VOICE) out.add(a.voice || SOUND_IDS.talk);
      if (a.type === 'choice') for (const o of a.options) soundsOfActions(o.actions, out);
    }
  }
}

/** A copy of the project made smaller for export. The project itself is not changed. */
export function pruneForExport(project: Project): Project {
  const modelIds = new Set<string>();
  const textureNames = new Set<string>();
  const soundIds = new Set<string>();

  for (const level of project.levels) {
    for (const o of level.objects) {
      if (o.kind === 'model') modelIds.add(o.modelId);
      else {
        if (o.tile) textureNames.add(o.tile.texture);
        for (const f of o.mesh.faces) if (f.tile) textureNames.add(f.tile.texture);
      }
      for (const r of o.rules) soundsOfActions(r.actions, soundIds);
    }
  }
  const p = project.player;
  if (p.modelId) modelIds.add(p.modelId);
  for (const a of p.attachments) modelIds.add(a.modelId);
  if (p.skin) textureNames.add(p.skin);
  for (const id of [p.soundJump, p.soundDoubleJump, p.soundLand, p.soundStep, project.settings.music]) if (id) soundIds.add(id);

  // a variant needs the component it is made from, and a component the components placed inside it
  const byId = (id: string) => project.models.find((m) => m.id === id);
  for (const id of [...modelIds]) {
    const m = byId(id);
    if (m) for (const dep of dependenciesOf(m, byId)) modelIds.add(dep);
  }

  // what the editor keeps for itself (the default behavior of a component) means nothing in the game: the instances
  // have what they do
  const models = project.models
    .filter((m) => modelIds.has(m.id))
    .map((m) => {
      const { defaults: _defaults, component: _component, ...rest } = m;
      return rest;
    });
  for (const m of models) {
    if (m.texture) textureNames.add(m.texture);
    for (const c of m.cubes) for (const f of c.mesh.faces) if (f.tile) textureNames.add(f.tile.texture);
  }

  return {
    ...project,
    models,
    textures: project.textures.filter((t) => textureNames.has(t.name)),
    sounds: project.sounds.filter((s) => soundIds.has(s.id)),
    exported: true,
  };
}
